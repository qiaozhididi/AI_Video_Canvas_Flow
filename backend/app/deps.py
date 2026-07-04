"""通用依赖注入：数据库会话 + JWT 认证"""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import settings
from app.database import async_session_factory

logger = logging.getLogger("app.deps")

security = HTTPBearer(auto_error=False)


async def get_db():
    """获取数据库会话"""
    async with async_session_factory() as session:
        yield session


def _verify_token(token: str) -> str:
    """验证 JWT Token，返回用户 ID"""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token 中缺少用户标识",
            )
        return user_id
    except JWTError as e:
        logger.warning(f"[Dep] Token 验证失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效或过期的认证凭据",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    """获取当前用户 ID，严格验证 JWT Token

    - 无 Token → 401
    - Token 无效/过期/伪造 → 401
    - Token 合法 → 返回 sub 字段（用户 ID）
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证凭据",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _verify_token(credentials.credentials)


async def get_current_user_optional_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    token: str | None = Query(None, alias="token"),
) -> str:
    """获取当前用户 ID，支持 Header 或 Query 参数传 Token

    用于 <video>/<img> 等无法设置自定义 Header 的场景：
    - 优先使用 Authorization Header
    - Header 不存在时使用 ?token=xxx 查询参数
    """
    if credentials is not None:
        return _verify_token(credentials.credentials)
    if token is not None:
        return _verify_token(token)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未提供认证凭据",
    )


# Annotated 类型别名，方便路由使用
DBSession = Annotated[object, Depends(get_db)]
CurrentUser = Annotated[str, Depends(get_current_user)]
CurrentUserWithToken = Annotated[str, Depends(get_current_user_optional_token)]
