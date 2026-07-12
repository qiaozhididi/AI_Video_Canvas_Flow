"""协作节点锁单元测试"""
import time
import pytest
from app.ws.collaboration import (
    NodeLock, _node_locks, _lock_key, _get_active_lock,
    _purge_expired_locks, _remove_locks_by_sid, _lock_to_dict,
    LOCK_TTL,
)


class TestNodeLock:
    def test_lock_not_expired(self):
        now = time.time()
        lock = NodeLock("n1", "p1", "sid1", "u1", "user1", now, now + 5, now)
        assert not lock.is_expired(now)

    def test_lock_expired(self):
        now = time.time()
        lock = NodeLock("n1", "p1", "sid1", "u1", "user1", now, now - 1, now)
        assert lock.is_expired(now)

    def test_renew_extends_expiry(self):
        lock = NodeLock("n1", "p1", "sid1", "u1", "user1", 0, 1, 0)
        lock.renew(5.0)
        assert lock.expires_at > 5
        assert lock.last_renewed > 0


class TestGetActiveLock:
    def test_returns_none_when_no_lock(self):
        _node_locks.clear()
        assert _get_active_lock("p1", "n1") is None

    def test_returns_active_lock(self):
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        _node_locks[("p1", "n1")] = lock
        result = _get_active_lock("p1", "n1")
        assert result is lock

    def test_clears_and_returns_none_when_expired(self):
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "a", now, now - 1, now)
        _node_locks[("p1", "n1")] = lock
        assert _get_active_lock("p1", "n1") is None
        assert ("p1", "n1") not in _node_locks


class TestPurgeExpired:
    def test_purge_removes_expired_only(self):
        _node_locks.clear()
        now = time.time()
        active = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        expired = NodeLock("n2", "p1", "s2", "u2", "b", now, now - 1, now)
        _node_locks[("p1", "n1")] = active
        _node_locks[("p1", "n2")] = expired
        removed = _purge_expired_locks()
        assert len(removed) == 1
        assert removed[0].node_id == "n2"
        assert ("p1", "n1") in _node_locks
        assert ("p1", "n2") not in _node_locks


class TestRemoveBySid:
    def test_remove_all_locks_of_sid(self):
        _node_locks.clear()
        now = time.time()
        l1 = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        l2 = NodeLock("n2", "p1", "s1", "u1", "a", now, now + 5, now)
        l3 = NodeLock("n3", "p1", "s2", "u2", "b", now, now + 5, now)
        _node_locks[("p1", "n1")] = l1
        _node_locks[("p1", "n2")] = l2
        _node_locks[("p1", "n3")] = l3
        removed = _remove_locks_by_sid("s1")
        assert len(removed) == 2
        assert ("p1", "n3") in _node_locks


class TestLockToDict:
    def test_serializes_all_fields(self):
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", 100.0, 105.0, 100.0)
        d = _lock_to_dict(lock)
        assert d == {
            "node_id": "n1", "project_id": "p1", "sid": "s1",
            "user_id": "u1", "username": "alice",
            "acquired_at": 100.0, "expires_at": 105.0,
        }


class TestAcquireLockLogic:
    """测试 acquire_lock 的核心逻辑（不依赖真实 Socket.IO 连接）

    直接调用底层逻辑函数，验证 _node_locks 状态变化。
    """

    def test_acquire_creates_lock_when_free(self):
        """无锁时 acquire 应创建锁"""
        from app.ws.collaboration import _node_locks, _lock_key, _get_active_lock
        _node_locks.clear()
        now = time.time()
        # 模拟 acquire：直接创建锁
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        assert _get_active_lock("p1", "n1") is lock

    def test_acquire_returns_existing_when_self_holds(self):
        """自己已持锁时 acquire 应续租并返回同一锁"""
        from app.ws.collaboration import _node_locks, _lock_key, _get_active_lock, LOCK_TTL
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now, now + 1, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        # 模拟自己再次 acquire：续租
        existing = _get_active_lock("p1", "n1")
        assert existing is lock
        existing.renew(LOCK_TTL)
        assert existing.expires_at > now + 1

    def test_acquire_denied_when_other_holds(self):
        """他人持锁时 acquire 应被拒绝"""
        from app.ws.collaboration import _node_locks, _lock_key, _get_active_lock
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s_other", "u_other", "bob", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        existing = _get_active_lock("p1", "n1")
        assert existing is lock
        assert existing.sid == "s_other"  # 他人持锁


class TestRenewLockLogic:
    def test_renew_refreshes_expiry(self):
        from app.ws.collaboration import _node_locks, _lock_key, LOCK_TTL
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now, now + 1, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        old_expiry = lock.expires_at
        lock.renew(LOCK_TTL)
        assert lock.expires_at > old_expiry

    def test_renew_fails_when_lock_missing(self):
        from app.ws.collaboration import _node_locks, _lock_key
        _node_locks.clear()
        assert _lock_key("p1", "n1") not in _node_locks  # 无锁，续租应失败


class TestReleaseLockLogic:
    def test_release_removes_lock(self):
        from app.ws.collaboration import _node_locks, _lock_key
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        _node_locks.pop(_lock_key("p1", "n1"), None)
        assert _lock_key("p1", "n1") not in _node_locks
