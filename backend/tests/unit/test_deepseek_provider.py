"""DeepSeek 适配器的离线契约测试。"""

import asyncio
import json
import unittest
from unittest.mock import patch

from app.domain.rag import ContextItem, ContextPackage, FusedHit, RagQuery, SourceReference
from app.services.rag.deepseek import DeepSeekAnswerGenerator


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        from io import BytesIO

        return BytesIO(self._body)

    def __exit__(self, *_args):
        return False


class DeepSeekProviderTests(unittest.TestCase):
    def test_sends_json_request_and_parses_citations(self) -> None:
        payload = {
            "choices": [{
                "finish_reason": "stop",
                "message": {"content": json.dumps({"answer": "依据第一条。", "citation_labels": ["S1"]})},
            }]
        }
        hit = FusedHit(
            text="第一条", source=SourceReference(
                knowledge_base_id="kb", document_id="doc", version_id="ver",
                chunk_id="chunk", title="制度",
            ), relevance_score=1.0, channels=("vector",), channel_ranks=(("vector", 1),),
        )
        context = ContextPackage(
            text="[S1] 第一条", items=(ContextItem("S1", hit, "[S1] 第一条"),),
        )
        with patch("app.services.rag.deepseek.urlopen", return_value=FakeResponse(payload)) as call:
            result = asyncio.run(
                DeepSeekAnswerGenerator("test-key").generate(RagQuery("是什么？"), context)
            )
            self.assertEqual(result.answer, "依据第一条。")
            self.assertEqual(result.citation_labels, ("S1",))
            request = call.call_args.args[0]
            body = json.loads(request.data)
            self.assertEqual(body["response_format"], {"type": "json_object"})
            self.assertIn("Markdown", body["messages"][0]["content"])
            self.assertIn("### 结论", body["messages"][0]["content"])
            self.assertIn("列表逐项说明", body["messages"][0]["content"])
            self.assertIn("citation_labels 返回空数组", body["messages"][0]["content"])
            self.assertEqual(request.get_header("Authorization"), "Bearer test-key")

    def test_rejects_truncated_output(self) -> None:
        payload = {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}
        with patch("app.services.rag.deepseek.urlopen", return_value=FakeResponse(payload)):
            with self.assertRaisesRegex(ValueError, "未完整结束"):
                asyncio.run(DeepSeekAnswerGenerator("test-key").generate(
                    RagQuery("是什么？"), ContextPackage(text="证据", items=())
                ))
