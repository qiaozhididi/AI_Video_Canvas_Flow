"""认证路由：登录/注册/Token"""

import logging
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from jose import jwt
from sqlalchemy import select

from app.config import settings
from app.deps import DBSession, CurrentUser
from app.models.user import User

logger = logging.getLogger("app.api.auth")

router = APIRouter()


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
    avatar_url: str | None


class UserUpdateRequest(BaseModel):
    """用户信息更新请求"""
    username: str | None = None
    email: str | None = None
    avatar_url: str | None = None


def _create_token(user_id: str, expires_minutes: int) -> str:
    """创建 JWT Token"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


@router.post("/register", response_model=UserResponse, summary="注册新用户")
async def register(body: RegisterRequest, db: DBSession):
    """注册新用户"""
    # 检查用户名是否已存在
    stmt = select(User).where(User.username == body.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 检查邮箱是否已存在
    stmt = select(User).where(User.email == body.email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="邮箱已被注册")

    # 创建用户
    hashed_password = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hashed_password,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    user_id = str(user.id)
    logger.info(f"[Auth:Register] user={body.username} id={user_id}")
    return UserResponse(id=user_id, username=user.username, email=user.email, avatar_url=user.avatar_url)


@router.post("/login", response_model=TokenResponse, summary="用户登录")
async def login(body: LoginRequest, db: DBSession):
    """用户登录，返回 JWT Token"""
    stmt = select(User).where(User.username == body.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not bcrypt.checkpw(body.password.encode(), user.hashed_password.encode()):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    user_id = str(user.id)
    access_token = _create_token(user_id, settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token = _create_token(user_id, 60 * 24 * 7)  # 7天

    logger.info(f"[Auth:Login] user={body.username}")
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.get("/me", response_model=UserResponse, summary="获取当前用户信息")
async def get_me(db: DBSession, current_user_id: CurrentUser):
    """获取当前用户信息"""
    import uuid
    stmt = select(User).where(User.id == uuid.UUID(current_user_id))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    return UserResponse(id=str(user.id), username=user.username, email=user.email, avatar_url=user.avatar_url)


@router.put("/me", response_model=UserResponse, summary="更新当前用户信息")
async def update_me(body: UserUpdateRequest, db: DBSession, current_user_id: CurrentUser):
    """更新当前用户信息（用户名/邮箱/头像 URL）"""
    import uuid
    stmt = select(User).where(User.id == uuid.UUID(current_user_id))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    # 如修改 username，校验唯一性（排除当前用户）
    if body.username is not None and body.username != user.username:
        stmt = select(User).where(User.username == body.username, User.id != user.id)
        result = await db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="用户名已存在")
        user.username = body.username

    # 如修改 email，校验唯一性（排除当前用户）
    if body.email is not None and body.email != user.email:
        stmt = select(User).where(User.email == body.email, User.id != user.id)
        result = await db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="邮箱已被注册")
        user.email = body.email

    # 如修改 avatar_url
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url

    await db.commit()
    await db.refresh(user)

    logger.info(f"[Auth:UpdateMe] user_id={current_user_id}")
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        avatar_url=user.avatar_url,
    )
