"""密码、访问令牌与刷新令牌的安全原语。"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings

ACCESS_TTL_SECONDS = 900
REFRESH_TTL_DAYS = 7
REFRESH_COOKIE = "finrag_refresh"
DOCUMENT_TICKET_TTL_SECONDS = 120
DOCUMENT_TICKET_SCOPE = "document_file"

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def create_access_token(user_id: str) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": user_id, "iat": now, "exp": now + timedelta(seconds=ACCESS_TTL_SECONDS), "jti": str(uuid4())},
        get_settings().jwt_secret,
        algorithm="HS256",
    )


def decode_access_token(token: str) -> str:
    payload = jwt.decode(
        token,
        get_settings().jwt_secret,
        algorithms=["HS256"],
        options={"require": ["sub", "iat", "exp", "jti"]},
    )
    return str(payload["sub"])


def create_document_ticket(user_id: str, document_id: str, ttl: int = DOCUMENT_TICKET_TTL_SECONDS) -> str:
    """短时原文访问票据。

    浏览器的 PDF 阅读器无法携带 `Authorization` 头，只能把票据放进 URL；
    因此票据与 Access Token 分开：作用域限定为单个文档，默认 2 分钟过期。
    """
    issued = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": user_id,
            "doc": document_id,
            "scope": DOCUMENT_TICKET_SCOPE,
            "iat": issued,
            "exp": issued + timedelta(seconds=ttl),
            "jti": str(uuid4()),
        },
        get_settings().jwt_secret,
        algorithm="HS256",
    )


def decode_document_ticket(token: str) -> str:
    """校验原文票据并返回它授权的文档 ID。"""
    payload = jwt.decode(
        token,
        get_settings().jwt_secret,
        algorithms=["HS256"],
        options={"require": ["sub", "doc", "scope", "iat", "exp", "jti"]},
    )
    if payload.get("scope") != DOCUMENT_TICKET_SCOPE:
        raise jwt.InvalidTokenError("ticket scope mismatch")
    return str(payload["doc"])


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
