"""业务路由共享的鉴权依赖。"""

from typing import Annotated

import jwt
from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.exceptions import ApiError
from app.core.security import decode_access_token
from app.repositories.auth_models import UserRecord


def current_user(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> UserRecord:
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "AUTH_SESSION_INVALID", "请先登录")
    try:
        user_id = decode_access_token(authorization.removeprefix("Bearer "))
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(401, "AUTH_TOKEN_EXPIRED", "访问令牌已过期") from exc
    except jwt.InvalidTokenError as exc:
        raise ApiError(401, "AUTH_SESSION_INVALID", "访问令牌无效") from exc
    user = db.get(UserRecord, user_id)
    if user is None or user.status != "active":
        raise ApiError(401, "AUTH_ACCOUNT_UNAVAILABLE", "账户不可用")
    if user.role not in {"admin", "user"}:
        raise ApiError(403, "AUTH_FORBIDDEN", "当前用户无权执行操作")
    return user
