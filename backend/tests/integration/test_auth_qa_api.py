"""使用 SQLite 文件执行真实 ASGI 请求，验证契约和会话轮换。"""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie

import jwt
from sqlalchemy import select

from app.core.database import session_factory
from app.core.security import hash_password
from app.domain.rag import EvidenceSupport, EvidenceSupportLevel, RagAnswer
from app.main import app
from app.repositories.auth_models import QaRecord, UserRecord


async def request(method, path, *, body=None, token=None, cookie=None):
    payload = b"" if body is None else json.dumps(body).encode()
    headers = [(b"content-type", b"application/json")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if cookie:
        headers.append((b"cookie", cookie.encode()))
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
        "query_string": b"", "root_path": "", "headers": headers,
        "client": ("127.0.0.1", 12345), "server": ("testserver", 80),
    }
    messages = []
    received = False

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": payload, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    start = next(item for item in messages if item["type"] == "http.response.start")
    data = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
    return start["status"], dict(start["headers"]), json.loads(data) if data else None


def cookie_value(headers):
    parsed = SimpleCookie()
    parsed.load(headers[b"set-cookie"].decode())
    return parsed["finrag_refresh"].value


def test_login_refresh_logout_and_qa(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'api.db').as_posix()}")
    monkeypatch.setenv("JWT_SECRET_KEY", "integration_test_secret_longer_than_32_characters")
    monkeypatch.setenv("ADMIN_BOOTSTRAP_PASSWORD", "integration_admin_password")

    async def scenario():
        async with app.router.lifespan_context(app):
            status, _, body = await request("POST", "/api/v1/auth/login", body={"username": "admin", "password": "wrong"})
            assert status == 401 and body["error_code"] == "AUTH_INVALID_CREDENTIALS"
            status, _, body = await request("POST", "/api/v1/auth/login", body={"username": "admin"})
            assert status == 422 and body["error_code"] == "VALIDATION_ERROR"

            status, _, body = await request("POST", "/api/v1/auth/register", body={"username": "new_user"})
            assert status == 422 and body["error_code"] == "VALIDATION_ERROR"
            status, _, body = await request("POST", "/api/v1/auth/register", body={"username": "admin", "password": "any"})
            assert status == 409 and body["error_code"] == "AUTH_USERNAME_EXISTS"
            status, headers, body = await request("POST", "/api/v1/auth/register", body={"username": "new_user", "password": "simple"})
            assert status == 201 and body["user"]["role"] == "user"
            assert b"httponly" in headers[b"set-cookie"].lower()
            status, _, body = await request("GET", "/api/v1/users/me", token=body["access_token"])
            assert status == 200 and body["username"] == "new_user"
            status, _, body = await request("POST", "/api/v1/auth/login", body={"username": "new_user", "password": "simple"})
            assert status == 200 and body["user"]["username"] == "new_user"

            status, headers, body = await request("POST", "/api/v1/auth/login", body={"username": "admin", "password": "integration_admin_password"})
            assert status == 200 and body["user"]["role"] == "admin"
            assert b"httponly" in headers[b"set-cookie"].lower()
            access = body["access_token"]
            user_id = body["user"]["id"]
            first_refresh = cookie_value(headers)

            status, _, body = await request("GET", "/api/v1/users/me", token=access)
            assert status == 200 and body["username"] == "admin"
            status, _, body = await request("GET", "/api/v1/users/me")
            assert status == 401 and body["error_code"] == "AUTH_SESSION_INVALID"
            expired = jwt.encode(
                {"sub": user_id, "iat": datetime.now(UTC) - timedelta(minutes=20),
                 "exp": datetime.now(UTC) - timedelta(minutes=5), "jti": "expired-test"},
                "integration_test_secret_longer_than_32_characters", algorithm="HS256",
            )
            status, _, body = await request("GET", "/api/v1/users/me", token=expired)
            assert status == 401 and body["error_code"] == "AUTH_TOKEN_EXPIRED"

            status, _, body = await request("POST", "/api/v1/qa/answer", body={"question": "制度依据？"}, token=access)
            assert status == 503 and body["error_code"] == "RAG_RETRIEVAL_UNAVAILABLE"

            class NoEvidenceService:
                async def answer(self, _query):
                    return RagAnswer(
                        answer="未在当前有效制度中检索到足够依据，暂无法回答该问题。",
                        citations=(),
                        evidence_support=EvidenceSupport(
                            score=0, level=EvidenceSupportLevel.NONE,
                            method="retrieval_evidence_v1", explanation="当前证据不足。",
                        ),
                    )

            app.state.rag_service = NoEvidenceService()
            try:
                status, _, body = await request("POST", "/api/v1/qa/answer", body={"question": "制度依据？"}, token=access)
                assert status == 200 and body["citations"] == []
                assert body["evidence_support"]["level"] == "none"
                with session_factory()() as db:
                    saved = db.scalar(select(QaRecord).where(QaRecord.trace_id == body["trace_id"]))
                    assert saved is not None and saved.question == "制度依据？"
            finally:
                del app.state.rag_service

            status, headers, body = await request("POST", "/api/v1/auth/refresh", cookie=f"finrag_refresh={first_refresh}")
            assert status == 200 and body["access_token"] != access
            second_refresh = cookie_value(headers)
            assert second_refresh != first_refresh
            status, _, body = await request("POST", "/api/v1/auth/refresh", cookie=f"finrag_refresh={first_refresh}")
            assert status == 401 and body["error_code"] == "AUTH_SESSION_INVALID"
            status, _, body = await request("POST", "/api/v1/auth/refresh", cookie=f"finrag_refresh={second_refresh}")
            assert status == 401 and body["error_code"] == "AUTH_SESSION_INVALID"

            status, headers, _ = await request("POST", "/api/v1/auth/logout", cookie=f"finrag_refresh={second_refresh}")
            assert status == 204 and b"max-age=0" in headers[b"set-cookie"].lower()

            for _ in range(5):
                status, _, _ = await request("POST", "/api/v1/auth/login", body={"username": "admin", "password": "wrong"})
                assert status == 401
            status, _, body = await request("POST", "/api/v1/auth/login", body={"username": "admin", "password": "integration_admin_password"})
            assert status == 401 and body["error_code"] == "AUTH_INVALID_CREDENTIALS"

    asyncio.run(scenario())


def test_default_admin_exists_without_extra_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'default.db').as_posix()}")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("ADMIN_BOOTSTRAP_PASSWORD", raising=False)

    async def scenario():
        async with app.router.lifespan_context(app):
            status, _, body = await request(
                "POST", "/api/v1/auth/login",
                body={"username": "admin", "password": "finrag2026"},
            )
            assert status == 200 and body["user"]["role"] == "admin"
            with session_factory()() as db:
                admin = db.scalar(select(UserRecord).where(UserRecord.username == "admin"))
                admin.password_hash = hash_password("旧密码")
                db.commit()
        async with app.router.lifespan_context(app):
            status, _, body = await request(
                "POST", "/api/v1/auth/login",
                body={"username": "admin", "password": "finrag2026"},
            )
            assert status == 200 and body["user"]["role"] == "admin"

    asyncio.run(scenario())
