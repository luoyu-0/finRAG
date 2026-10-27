"""鉴权接口输入与输出。"""

from typing import Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1)


class UserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    role: Literal["admin", "user"]
    status: Literal["active", "disabled"]


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = 900
    user: UserResponse


class RefreshResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = 900
