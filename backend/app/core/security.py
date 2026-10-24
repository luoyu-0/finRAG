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


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
