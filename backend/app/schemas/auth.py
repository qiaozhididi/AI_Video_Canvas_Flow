"""登录/注册/Token Pydantic schema"""

from pydantic import BaseModel, EmailStr


class UserRegister(BaseModel):
    """用户注册请求"""
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    """用户登录请求"""
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Token 响应"""
    access_token: str
    token_type: str = "bearer"
