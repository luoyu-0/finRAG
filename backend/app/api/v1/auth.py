"""登录、刷新和退出接口。"""

from collections import deque
from threading import Lock
from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.exceptions import ApiError
from app.core.security import REFRESH_COOKIE, REFRESH_TTL_DAYS
from app.schemas.auth import LoginRequest, LoginResponse, RefreshResponse
from app.services.auth.service import login, logout, refresh_session

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_failed_logins: dict[str, deque[float]] = {}
_failure_lock = Lock()
_failure_window_seconds = 900
_failure_limit = 5


def login_key(request: Request, username: str) -> str:
    return f"{request.client.host if request.client else 'unknown'}:{username.strip().lower()}"


def check_login_limit(key: str) -> None:
    now = monotonic()
    with _failure_lock:
        attempts = _failed_logins.setdefault(key, deque())
        while attempts and now - attempts[0] > _failure_window_seconds:
            attempts.popleft()
        if len(attempts) >= _failure_limit:
            raise ApiError(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误")


def record_login_failure(key: str) -> None:
    with _failure_lock:
        _failed_logins.setdefault(key, deque()).append(monotonic())
        if len(_failed_logins) > 10_000:
            _failed_logins.pop(next(iter(_failed_logins)))


def clear_login_failures(key: str) -> None:
    with _failure_lock:
        _failed_logins.pop(key, None)


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE, value=token, httponly=True, secure=get_settings().cookie_secure,
        samesite="lax", path="/api/v1/auth", max_age=REFRESH_TTL_DAYS * 86400,
    )


@router.post("/login", response_model=LoginResponse)
def login_route(
    payload: LoginRequest, response: Response, request: Request,
    db: Annotated[Session, Depends(get_db)]
) -> LoginResponse:
    key = login_key(request, payload.username)
    check_login_limit(key)
    try:
        result, token = login(db, payload.username, payload.password)
    except ApiError:
        record_login_failure(key)
        raise
    clear_login_failures(key)
    set_refresh_cookie(response, token)
    return result


@router.post("/refresh", response_model=RefreshResponse)
def refresh_route(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    finrag_refresh: Annotated[str | None, Cookie()] = None,
) -> RefreshResponse:
    access_token, next_token = refresh_session(db, finrag_refresh)
    set_refresh_cookie(response, next_token)
    return RefreshResponse(access_token=access_token)


@router.post("/logout", status_code=204)
def logout_route(
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    finrag_refresh: Annotated[str | None, Cookie()] = None,
) -> None:
    logout(db, finrag_refresh)
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")
