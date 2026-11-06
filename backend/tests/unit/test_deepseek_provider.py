"""通过模拟 HTTP 响应验证真实 LangChain 适配链，不调用收费 API。"""

import json
from unittest.mock import patch

import httpx
import pytest
from langchain_deepseek import ChatDeepSeek

from app.domain.rag import ContextItem, ContextPackage, FusedHit, RagQuery, SourceReference
from app.services.rag.deepseek import DeepSeekAnswerGenerator


def context():
    hit = FusedHit(
        text="第一条", source=SourceReference(
            knowledge_base_id="kb", document_id="doc", version_id="ver",
            chunk_id="chunk", title="制度",
        ), relevance_score=1.0, channels=("vector",), channel_ranks=(("vector", 1),),
    )
    return ContextPackage(text="[S1] 第一条", items=(ContextItem("S1", hit, "[S1] 第一条"),))


def run_response(content, *, finish_reason="stop", status=200):
    import asyncio

    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(status, json={
            "id": "test", "object": "chat.completion", "created": 0,
            "model": "deepseek-flash",
            "choices": [{"index": 0, "finish_reason": finish_reason,
                         "message": {"role": "assistant", "content": content}}],
        })

    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            def model(**kwargs):
                return ChatDeepSeek(**kwargs, http_async_client=client)
            with patch("app.services.rag.deepseek.ChatDeepSeek", side_effect=model):
                generator = DeepSeekAnswerGenerator("test-key")
                return await generator.generate(RagQuery("是什么？{保留原文}"), context())

    return asyncio.run(execute()), requests


def test_sends_json_request_and_parses_citations():
    result, requests = run_response(json.dumps({"answer": "### 结论\n\n依据第一条[S1]。", "citation_labels": ["S1"]}))
    assert result.answer == "### 结论\n\n依据第一条[S1]。"
    assert result.citation_labels == ("S1",)
    assert len(requests) == 1
    body = requests[0]
    assert body["response_format"] == {"type": "json_object"}
    assert body["thinking"] == {"type": "disabled"}
    assert body["max_tokens"] == 1200
    assert "Markdown" in body["messages"][0]["content"]
    assert "### 结论" in body["messages"][0]["content"]
    assert "citation_labels 返回空数组" in body["messages"][0]["content"]
    assert "{保留原文}" in body["messages"][1]["content"]
    assert "[S1] 第一条" in body["messages"][1]["content"]


@pytest.mark.parametrize("content,finish_reason", [
    ('{}', "length"),
    ('{"answer":"截断', "stop"),
    ('[]', "stop"),
    ('{"answer":123,"citation_labels":[]}', "stop"),
    ('{"answer":"回答","citation_labels":"S1"}', "stop"),
    ('{"answer":"回答","citation_labels":["S9"]}', "stop"),
    ('{"answer":"回答","citation_labels":[1]}', "stop"),
])
def test_rejects_invalid_output(content, finish_reason):
    with pytest.raises(ValueError):
        run_response(content, finish_reason=finish_reason)


def test_allows_insufficient_evidence():
    result, _ = run_response('{"answer":"依据不足","citation_labels":[]}')
    assert result.citation_labels == ()


def test_rejects_empty_key():
    with pytest.raises(ValueError, match="不能为空"):
        DeepSeekAnswerGenerator(" ")


def test_propagates_http_error():
    from openai import RateLimitError

    with pytest.raises(RateLimitError):
        run_response("{}", status=429)
