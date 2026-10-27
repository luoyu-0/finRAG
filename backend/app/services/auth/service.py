"""用户登录、令牌轮换和退出的业务规则。"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import ApiError
from app.core.security import (
    REFRESH_TTL_DAYS,
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.repositories.auth_models import RefreshSessionRecord, UserRecord
from app.schemas.auth import LoginResponse, UserResponse

_dummy_password_hash = hash_password("仅用于统一登录耗时的虚拟密码")


def utc_naive() -> datetime:
    """MySQL DATETIME 按 UTC 存储，由应用负责时区转换。"""
    return datetime.now(UTC).replace(tzinfo=None)


def public_user(user: UserRecord) -> UserResponse:
    return UserResponse.model_validate(
        {"id": user.id, "username": user.username, "display_name": user.display_name,
         "role": user.role, "status": user.status}
    )


def bootstrap_admin(db: Session) -> None:
    """空用户库首次启动时创建管理员；已有用户时绝不重设密码。"""
    if db.scalar(select(UserRecord.id).limit(1)) is not None:
        return
    settings = get_settings()
    if not settings.bootstrap_password or len(settings.bootstrap_password) < 12:
        raise RuntimeError("首次启动需提供至少 12 字符的 ADMIN_BOOTSTRAP_PASSWORD")
    db.add(UserRecord(
        id=str(uuid4()), username=settings.bootstrap_username,
        password_hash=hash_password(settings.bootstrap_password),
        display_name="管理员", role="admin", status="active", created_at=utc_naive(),
    ))
    db.commit()


def login(db: Session, username: str, password: str) -> tuple[LoginResponse, str]:
    user = db.scalar(select(UserRecord).where(UserRecord.username == username.strip()))
    password_valid = verify_password(user.password_hash if user else _dummy_password_hash, password)
    if user is None or not password_valid or user.status != "active":
        raise ApiError(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误")
    refresh = create_refresh_token()
    session_id = str(uuid4())
    db.add(RefreshSessionRecord(
        id=session_id, family_id=session_id, user_id=user.id,
        token_hash=hash_refresh_token(refresh),
        expires_at=utc_naive() + timedelta(days=REFRESH_TTL_DAYS),
        created_at=utc_naive(),
    ))
    db.commit()
    return LoginResponse(access_token=create_access_token(user.id), user=public_user(user)), refresh


def refresh_session(db: Session, token: str | None) -> tuple[str, str]:
    if not token:
        raise ApiError(401, "AUTH_SESSION_INVALID", "会话无效，请重新登录")
    now = utc_naive()
    record = db.scalar(select(RefreshSessionRecord).where(
        RefreshSessionRecord.token_hash == hash_refresh_token(token)
    ).with_for_update())
    if record is None:
        raise ApiError(401, "AUTH_SESSION_INVALID", "会话无效，请重新登录")
    if record.consumed_at is not None:
        db.execute(update(RefreshSessionRecord).where(
            RefreshSessionRecord.family_id == record.family_id,
            RefreshSessionRecord.revoked_at.is_(None),
        ).values(revoked_at=now))
        db.commit()
        raise ApiError(401, "AUTH_SESSION_INVALID", "会话无效，请重新登录")
    user = db.get(UserRecord, record.user_id)
    if record.revoked_at or record.expires_at <= now or user is None or user.status != "active":
        raise ApiError(401, "AUTH_SESSION_INVALID", "会话无效，请重新登录")
    record.consumed_at = now
    next_token = create_refresh_token()
    db.add(RefreshSessionRecord(
        id=str(uuid4()), family_id=record.family_id, user_id=user.id,
        token_hash=hash_refresh_token(next_token),
        expires_at=now + timedelta(days=REFRESH_TTL_DAYS), created_at=now,
    ))
    db.commit()
    return create_access_token(user.id), next_token


def logout(db: Session, token: str | None) -> None:
    if not token:
        return
    record = db.scalar(select(RefreshSessionRecord).where(
        RefreshSessionRecord.token_hash == hash_refresh_token(token)
    ))
    if record is not None:
        db.execute(update(RefreshSessionRecord).where(
            RefreshSessionRecord.family_id == record.family_id,
            RefreshSessionRecord.revoked_at.is_(None),
        ).values(revoked_at=utc_naive()))
        db.commit()
