"""流式增量必须先于完成到达，且最终格式与引用仍被校验。"""

import asyncio
import json

import pytest
from langchain_core.messages import AIMessageChunk

from app.domain.rag import GeneratorOutput, RagQuery
from app.services.rag.deepseek import DeepSeekAnswerGenerator, _answer_prefix
from tests.unit.test_deepseek_provider import context


def test_json_prefix_handles_every_split_and_escaped_unicode():
    answer = '### 结论\n金额为"10元"，路径\\记录😀[S1]'
    raw = json.dumps({"answer": answer, "citation_labels": ["S1"]}, ensure_ascii=True)
    previous = ""
    for end in range(len(raw) + 1):
        decoded = _answer_prefix(raw[:end])
        assert answer.startswith(decoded) and decoded.startswith(previous)
        previous = decoded
    assert previous == answer


@pytest.mark.parametrize("finish_reason", ["stop", "length"])
def test_stream_yields_before_completion_and_rejects_truncation(finish_reason, caplog):
    class Chain:
        resumed = False

        async def astream(self, args):
            yield AIMessageChunk(content='{"answer":"正文')
            self.resumed = True
            yield AIMessageChunk(content='[S1]","citation_labels":["S1"]}', response_metadata={"finish_reason": finish_reason})

    async def scenario():
        generator = DeepSeekAnswerGenerator.__new__(DeepSeekAnswerGenerator)
        generator._model_chain = Chain()
        stream = generator.generate_stream(RagQuery("问题"), context())
        assert await anext(stream) == "正文"
        assert not generator._model_chain.resumed
        if finish_reason == "length":
            with pytest.raises(ValueError, match="未完整结束"):
                _ = [part async for part in stream]
        else:
            parts = [part async for part in stream]
            assert parts == ["[S1]", GeneratorOutput("正文[S1]", ("S1",))]
    asyncio.run(scenario())
    records = [r for r in caplog.records if r.name == "app.services.rag.deepseek"]
    if finish_reason == "length":
        assert len(records) == 1
        diagnostic = records[0].getMessage()
        assert "stage=finish_reason finish_reason=length" in diagnostic
        assert "emitted_chars=6" in diagnostic
        assert "正文" not in diagnostic
    else:
        assert not records
