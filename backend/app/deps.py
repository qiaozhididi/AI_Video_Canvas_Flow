"""通用依赖注入（开发模式：跳过数据库和认证）"""

import logging
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import async_session_factory

logger = logging.getLogger("app.deps")

security = HTTPBearer(auto_error=False)


async def get_db():
    """获取数据库会话"""
    async with async_session_factory() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    """获取当前用户 ID（开发模式：跳过 Token 验证，返回默认用户）"""
    if credentials is None:
        logger.debug("[Dep] 无 Token，使用开发模式默认用户")
        return "user-dev"

    try:
        from jose import jwt
        from app.config import settings
        payload = jwt.decode(
            credentials.credentials,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        user_id = payload.get("sub", "user-dev")
        logger.debug(f"[Dep] Token 验证通过: user_id={user_id}")
        return user_id
    except Exception as e:
        logger.warning(f"[Dep] Token 验证失败: {e}，回退到开发模式")
        return "user-dev"


# Annotated 类型别名，方便路由使用
DBSession = Annotated[object, Depends(get_db)]
CurrentUser = Annotated[str, Depends(get_current_user)]
