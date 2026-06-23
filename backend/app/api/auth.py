"""认证路由：登录/注册/Token"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from jose import jwt

from app.config import settings

logger = logging.getLogger("app.api.auth")

router = APIRouter()

# 开发用内存用户存储
_dev_users: dict[str, dict] = {}


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    username: str
    email: str


def _create_token(user_id: str, expires_minutes: int) -> str:
    """创建 JWT Token"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


@router.post("/register", response_model=UserResponse, summary="注册新用户")
async def register(body: RegisterRequest):
    """注册新用户（开发模式：内存存储）"""
    if body.username in _dev_users:
        raise HTTPException(status_code=400, detail="用户名已存在")

    user_id = f"user-{len(_dev_users) + 1}"
    user = {
        "id": user_id,
        "username": body.username,
        "email": body.email,
        "password": body.password,  # 开发模式不加密
    }
    _dev_users[body.username] = user
    logger.info(f"[Auth:Register] user={body.username} id={user_id}")
    return UserResponse(id=user_id, username=body.username, email=body.email)


@router.post("/login", response_model=TokenResponse, summary="用户登录")
async def login(body: LoginRequest):
    """用户登录，返回 JWT Token"""
    user = _dev_users.get(body.username)
    if not user or user["password"] != body.password:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    access_token = _create_token(user["id"], settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token = _create_token(user["id"], 60 * 24 * 7)  # 7天

    logger.info(f"[Auth:Login] user={body.username}")
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.get("/me", response_model=UserResponse, summary="获取当前用户信息")
async def get_me():
    """获取当前用户信息（开发模式：返回第一个用户）"""
    if not _dev_users:
        raise HTTPException(status_code=401, detail="未登录")
    user = next(iter(_dev_users.values()))
    return UserResponse(id=user["id"], username=user["username"], email=user["email"])
