"""Token 验证逻辑单元测试

覆盖 deps.get_current_user 的所有分支：
1. 无 Token → 401
2. 无效 Token → 401
3. 篡改 Token → 401
4. 过期 Token → 401
5. 有效 Token → 返回 user_id
6. Token 缺少 sub → 401
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt

from app.config import settings
from app.deps import get_current_user


def _make_token(sub: str, secret: str = settings.SECRET_KEY, exp_minutes: int = 30) -> str:
    """辅助：创建测试用 JWT"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=exp_minutes)
    payload = {"sub": sub, "exp": expire}
    return jwt.encode(payload, secret, algorithm=settings.ALGORITHM)


# ── 测试：无 Token → 401 ──


@pytest.mark.asyncio
async def test_no_token_returns_401():
    """无 Token 时应抛出 401"""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=None)
    assert exc_info.value.status_code == 401
    assert "未提供认证凭据" in exc_info.value.detail


# ── 测试：无效 Token → 401 ──


@pytest.mark.asyncio
async def test_invalid_token_returns_401():
    """完全无效的 Token 字符串应返回 401"""
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid_token_xyz")
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=creds)
    assert exc_info.value.status_code == 401
    assert "无效或过期" in exc_info.value.detail


# ── 测试：篡改 Token → 401 ──


@pytest.mark.asyncio
async def test_tampered_token_returns_401():
    """在有效 Token 后追加字符应返回 401"""
    valid_token = _make_token("user-123")
    tampered = valid_token + "tampered"
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=tampered)
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=creds)
    assert exc_info.value.status_code == 401


# ── 测试：错误密钥签发的 Token → 401 ──


@pytest.mark.asyncio
async def test_wrong_secret_token_returns_401():
    """使用错误密钥签发的 Token 应返回 401"""
    token = _make_token("user-123", secret="wrong-secret-key")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=creds)
    assert exc_info.value.status_code == 401


# ── 测试：过期 Token → 401 ──


@pytest.mark.asyncio
async def test_expired_token_returns_401():
    """已过期的 Token 应返回 401"""
    token = _make_token("user-123", exp_minutes=-1)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=creds)
    assert exc_info.value.status_code == 401


# ── 测试：Token 缺少 sub 字段 → 401 ──


@pytest.mark.asyncio
async def test_token_missing_sub_returns_401():
    """Token 解码成功但缺少 sub 字段应返回 401"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    payload = {"exp": expire}  # 无 sub
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=creds)
    assert exc_info.value.status_code == 401
    assert "缺少用户标识" in exc_info.value.detail


# ── 测试：有效 Token → 返回 user_id ──


@pytest.mark.asyncio
async def test_valid_token_returns_user_id():
    """有效 Token 应正确返回 user_id"""
    user_id = "550e8400-e29b-41d4-a716-446655440000"
    token = _make_token(user_id)
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    result = await get_current_user(credentials=creds)
    assert result == user_id


# ── 测试：不同 user_id 的 Token 正确区分 ──


@pytest.mark.asyncio
async def test_different_users_return_different_ids():
    """不同用户的 Token 应返回不同的 user_id"""
    user_a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    user_b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

    token_a = _make_token(user_a)
    creds_a = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_a)
    result_a = await get_current_user(credentials=creds_a)

    token_b = _make_token(user_b)
    creds_b = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_b)
    result_b = await get_current_user(credentials=creds_b)

    assert result_a == user_a
    assert result_b == user_b
    assert result_a != result_b


# ── 测试：401 响应包含 WWW-Authenticate 头 ──


@pytest.mark.asyncio
async def test_401_includes_www_authenticate_header():
    """401 响应应包含 WWW-Authenticate: Bearer 头"""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials=None)
    assert exc_info.value.headers is not None
    assert exc_info.value.headers.get("WWW-Authenticate") == "Bearer"
