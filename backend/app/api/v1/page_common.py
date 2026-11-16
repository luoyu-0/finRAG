"""页面共享的权限与 SQL 分页。"""

from datetime import UTC, datetime
from typing import Annotated
from fastapi import Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.v1.deps import current_user
from app.core.database import get_db
from app.core.exceptions import ApiError
from app.repositories.auth_models import UserRecord

Db = Annotated[Session, Depends(get_db)]
User = Annotated[UserRecord, Depends(current_user)]


def require_admin(user: User):
    if user.role != "admin":
        raise ApiError(403, "AUTH_FORBIDDEN", "需要管理员权限")
    return user


Admin = Annotated[UserRecord, Depends(require_admin)]


def now():
    return datetime.now(UTC).replace(tzinfo=None)


def utc(value):
    return value.replace(tzinfo=UTC) if value else None


def pagination(page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 20):
    return page, page_size


Paging = Annotated[tuple[int, int], Depends(pagination)]


def paginate(db, statement, paging, render):
    page, size = paging
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = db.execute(statement.offset((page - 1) * size).limit(size))
    return dict(items=[render(*row) for row in rows], total=total, page=page, page_size=size, has_next=page * size < total)
