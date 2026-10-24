"""用户登录、令牌轮换和退出的业务规则。"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
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
    """创建或同步默认管理员，保证新旧数据库都可使用配置的密码。"""
    settings = get_settings()
    existing = db.scalar(select(UserRecord).where(UserRecord.username == settings.bootstrap_username))
    if existing is not None:
        if existing.role != "admin":
            raise RuntimeError("默认管理员用户名已被普通账户占用")
        if not verify_password(existing.password_hash, settings.bootstrap_password):
            existing.password_hash = hash_password(settings.bootstrap_password)
            db.execute(update(RefreshSessionRecord).where(
                RefreshSessionRecord.user_id == existing.id,
                RefreshSessionRecord.revoked_at.is_(None),
            ).values(revoked_at=utc_naive()))
            db.commit()
        return
    db.add(UserRecord(
        id=str(uuid4()), username=settings.bootstrap_username,
        password_hash=hash_password(settings.bootstrap_password),
        display_name="管理员", role="admin", status="active", created_at=utc_naive(),
    ))
    db.commit()


def register(db: Session, username: str, password: str) -> tuple[LoginResponse, str]:
    """创建普通账户并立即建立登录会话。"""
    normalized = username.strip()
    if db.scalar(select(UserRecord.id).where(UserRecord.username == normalized)):
        raise ApiError(409, "AUTH_USERNAME_EXISTS", "用户名已存在")
    db.add(UserRecord(
        id=str(uuid4()), username=normalized, password_hash=hash_password(password),
        display_name=normalized, role="user", status="active", created_at=utc_naive(),
    ))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "AUTH_USERNAME_EXISTS", "用户名已存在") from exc
    return login(db, normalized, password)


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
