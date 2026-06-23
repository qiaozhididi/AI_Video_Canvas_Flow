"""认证路由：登录/注册/Token 刷新"""

from fastapi import APIRouter

from app.schemas.auth import TokenResponse, UserLogin, UserRegister

router = APIRouter()


@router.post("/register", response_model=TokenResponse, summary="用户注册")
async def register(body: UserRegister):
    """注册新用户并返回访问令牌"""
    # TODO: 调用 auth_service 完成注册
    return TokenResponse(access_token="placeholder", token_type="bearer")


@router.post("/login", response_model=TokenResponse, summary="用户登录")
async def login(body: UserLogin):
    """用户登录，返回 JWT 访问令牌"""
    # TODO: 调用 auth_service 完成登录
    return TokenResponse(access_token="placeholder", token_type="bearer")


@router.post("/refresh", response_model=TokenResponse, summary="刷新令牌")
async def refresh_token():
    """使用刷新令牌获取新的访问令牌"""
    # TODO: 调用 auth_service 刷新令牌
    return TokenResponse(access_token="placeholder", token_type="bearer")
