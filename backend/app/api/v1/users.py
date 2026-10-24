"""当前登录用户接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1.deps import current_user
from app.repositories.auth_models import UserRecord
from app.schemas.auth import UserResponse
from app.services.auth.service import public_user

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_me(user: Annotated[UserRecord, Depends(current_user)]) -> UserResponse:
    return public_user(user)
