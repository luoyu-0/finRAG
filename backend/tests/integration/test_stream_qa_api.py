"""流式接口鉴权、完成持久化和失败不落成功历史。"""

import asyncio
import json

import httpx
from sqlalchemy import func, select

from app.core.database import session_factory
from app.domain.rag import EvidenceSupport, EvidenceSupportLevel, RagAnswer
from app.main import app
from app.repositories.auth_models import QaRecord
from app.services.rag.errors import GenerationFailedError


def test_stream_auth_success_and_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'stream.db'}")
    monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "stream_test_password")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")

    class Service:
        fail = False

        async def stream_answer(self, query):
            yield "### 结论\n正文"
            if self.fail:
                raise GenerationFailedError("内部细节不可泄露")
            yield RagAnswer(answer="### 结论\n正文", citations=(), evidence_support=EvidenceSupport(
                score=0, level=EvidenceSupportLevel.NONE, method="test", explanation="测试",
            ))

    async def scenario():
        async with app.router.lifespan_context(app):
            service = Service()
            app.state.rag_service = service
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    assert (await client.post("/api/v1/qa/answer/stream", json={"question": "问题"})).status_code == 401
                    login = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "stream_test_password"})
                    headers = {"Authorization": "Bearer " + login.json()["access_token"]}
                    result = await client.post("/api/v1/qa/answer/stream", json={"question": "问题"}, headers=headers)
                    assert result.headers["x-accel-buffering"] == "no"
                    assert "event: delta" in result.text and "event: done" in result.text
                    final = json.loads(result.text.split("event: done\ndata: ")[1].strip())
                    assert final["answer"] == "### 结论\n正文" and final["trace_id"]
                    service.fail = True
                    result = await client.post("/api/v1/qa/answer/stream", json={"question": "问题"}, headers=headers)
                    assert "event: error" in result.text and "event: done" not in result.text
                    assert "内部细节" not in result.text
                    with session_factory()() as db:
                        assert db.scalar(select(func.count()).select_from(QaRecord)) == 1
            finally:
                del app.state.rag_service
    asyncio.run(scenario())
