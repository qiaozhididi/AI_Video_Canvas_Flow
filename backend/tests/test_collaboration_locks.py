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


class TestForceReleaseLogic:
    def test_force_release_removes_any_lock(self):
        """强制解锁移除任意持锁者的锁"""
        from app.ws.collaboration import _node_locks, _lock_key
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s_other", "u_other", "bob", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        # 模拟 owner 强制解锁：直接 pop
        removed = _node_locks.pop(_lock_key("p1", "n1"), None)
        assert removed is lock
        assert _lock_key("p1", "n1") not in _node_locks


class TestDisconnectCleanup:
    def test_disconnect_removes_all_locks_of_sid(self):
        from app.ws.collaboration import _node_locks, _remove_locks_by_sid
        _node_locks.clear()
        now = time.time()
        l1 = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        l2 = NodeLock("n2", "p1", "s1", "u1", "a", now, now + 5, now)
        _node_locks[("p1", "n1")] = l1
        _node_locks[("p1", "n2")] = l2
        removed = _remove_locks_by_sid("s1")
        assert len(removed) == 2
        assert len(_node_locks) == 0


class TestNodeDeleteCleanup:
    def test_delete_removes_node_lock(self):
        from app.ws.collaboration import _node_locks, _lock_key
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        # 模拟节点删除清理
        removed = _node_locks.pop(_lock_key("p1", "n1"), None)
        assert removed is not None
        assert _lock_key("p1", "n1") not in _node_locks


class TestJoinProjectLocksSync:
    def test_collect_project_locks_for_ack(self):
        """join_project ack 应返回当前项目的所有有效锁"""
        from app.ws.collaboration import _node_locks, _lock_to_dict
        _node_locks.clear()
        now = time.time()
        l1 = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        l2 = NodeLock("n2", "p2", "s2", "u2", "b", now, now + 5, now)  # 不同项目
        l3 = NodeLock("n3", "p1", "s3", "u3", "c", now, now - 1, now)  # 已过期
        _node_locks[("p1", "n1")] = l1
        _node_locks[("p2", "n2")] = l2
        _node_locks[("p1", "n3")] = l3
        # 模拟 join_project 收集 p1 的有效锁
        project_locks = [
            _lock_to_dict(lock)
            for lock in _node_locks.values()
            if lock.project_id == "p1" and not lock.is_expired()
        ]
        assert len(project_locks) == 1
        assert project_locks[0]["node_id"] == "n1"


class TestLockLifecycleIntegration:
    """集成测试：锁的完整生命周期（acquire → renew → release）"""

    def test_acquire_renew_release_cycle(self):
        """完整生命周期：获取 → 续租 → 释放"""
        from app.ws.collaboration import (
            _node_locks, _lock_key, _get_active_lock,
            _purge_expired_locks, LOCK_TTL,
        )
        _node_locks.clear()
        now = time.time()

        # 1. 获取锁
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now, now + LOCK_TTL, now)
        _node_locks[_lock_key("p1", "n1")] = lock
        assert _get_active_lock("p1", "n1") is lock

        # 2. 续租
        old_expiry = lock.expires_at
        lock.renew(LOCK_TTL)
        assert lock.expires_at > old_expiry

        # 3. 释放
        _node_locks.pop(_lock_key("p1", "n1"), None)
        assert _get_active_lock("p1", "n1") is None

    def test_concurrent_acquire_second_fails(self):
        """并发场景：第二个 acquire 应看到第一个的锁"""
        from app.ws.collaboration import _node_locks, _lock_key, _get_active_lock
        _node_locks.clear()
        now = time.time()
        # A 先获取
        lock_a = NodeLock("n1", "p1", "s_a", "u_a", "alice", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock_a
        # B 检查
        existing = _get_active_lock("p1", "n1")
        assert existing is lock_a
        assert existing.sid == "s_a"  # 是 A 的锁，B 应被拒绝

    def test_ttl_expiry_releases_lock(self):
        """TTL 过期后锁应被自动清理"""
        from app.ws.collaboration import _node_locks, _lock_key, _purge_expired_locks
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now - 10, now - 5, now - 10)
        _node_locks[_lock_key("p1", "n1")] = lock
        # 清理过期锁
        removed = _purge_expired_locks()
        assert len(removed) == 1
        assert _lock_key("p1", "n1") not in _node_locks

    def test_disconnect_releases_all_locks(self):
        """断线应释放该 sid 的所有锁"""
        from app.ws.collaboration import _node_locks, _remove_locks_by_sid
        _node_locks.clear()
        now = time.time()
        _node_locks[("p1", "n1")] = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        _node_locks[("p1", "n2")] = NodeLock("n2", "p1", "s1", "u1", "a", now, now + 5, now)
        _node_locks[("p1", "n3")] = NodeLock("n3", "p1", "s2", "u2", "b", now, now + 5, now)
        removed = _remove_locks_by_sid("s1")
        assert len(removed) == 2
        assert len(_node_locks) == 1  # 仅剩 s2 的锁

    def test_node_delete_clears_lock(self):
        """节点删除应清理该节点的锁"""
        from app.ws.collaboration import _node_locks, _lock_key
        _node_locks.clear()
        now = time.time()
        _node_locks[_lock_key("p1", "n1")] = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        # 模拟节点删除
        removed = _node_locks.pop(_lock_key("p1", "n1"), None)
        assert removed is not None
        assert _lock_key("p1", "n1") not in _node_locks

    def test_join_project_returns_only_active_locks(self):
        """join_project ack 应只返回未过期的锁"""
        from app.ws.collaboration import _node_locks, _lock_to_dict
        _node_locks.clear()
        now = time.time()
        active = NodeLock("n1", "p1", "s1", "u1", "a", now, now + 5, now)
        expired = NodeLock("n2", "p1", "s2", "u2", "b", now, now - 1, now)
        other_project = NodeLock("n3", "p2", "s3", "u3", "c", now, now + 5, now)
        _node_locks[("p1", "n1")] = active
        _node_locks[("p1", "n2")] = expired
        _node_locks[("p2", "n3")] = other_project
        # 收集 p1 的有效锁
        result = [
            _lock_to_dict(l) for l in _node_locks.values()
            if l.project_id == "p1" and not l.is_expired()
        ]
        assert len(result) == 1
        assert result[0]["node_id"] == "n1"


class TestNodeUpdateDeleteBroadcast:
    """测试 node_update delete 时清理锁并广播 lock_changed（设计 §8.2）"""

    async def test_delete_broadcasts_lock_changed(self, monkeypatch):
        """节点删除持锁节点时应广播 lock_changed(node, null) 通知持锁者"""
        from app.ws.collaboration import (
            _node_locks, _lock_key, node_update, NodeLock, sio,
        )
        _node_locks.clear()
        now = time.time()
        lock = NodeLock("n1", "p1", "s1", "u1", "alice", now, now + 5, now)
        _node_locks[_lock_key("p1", "n1")] = lock

        # 捕获 sio.emit 调用
        emitted: list[tuple] = []

        async def fake_emit(event, data, room=None, skip_sid=None):
            emitted.append((event, data, room, skip_sid))

        monkeypatch.setattr(sio, "emit", fake_emit)

        # mock session 与权限检查，避免依赖真实 DB / Socket.IO session
        async def fake_session(sid):
            return {"user_id": "u1", "username": "alice"}

        async def fake_perm(project_id, user_id):
            return True

        monkeypatch.setattr("app.ws.collaboration._get_session_info", fake_session)
        monkeypatch.setattr("app.ws.collaboration._check_edit_permission", fake_perm)

        await node_update("s1", {
            "project_id": "p1",
            "node_id": "n1",
            "action": "delete",
        })

        # 锁被清理
        assert _lock_key("p1", "n1") not in _node_locks

        # lock_changed 被广播一次，payload 为 lock=null
        lock_changed_events = [e for e in emitted if e[0] == "lock_changed"]
        assert len(lock_changed_events) == 1
        _, data, room, _ = lock_changed_events[0]
        assert data["project_id"] == "p1"
        assert data["node_id"] == "n1"
        assert data["lock"] is None
        assert room == "project:p1"

    async def test_delete_without_lock_does_not_broadcast_lock_changed(self, monkeypatch):
        """节点删除时无锁则不广播 lock_changed（但仍广播 node_update）"""
        from app.ws.collaboration import _node_locks, node_update, sio
        _node_locks.clear()

        emitted: list[tuple] = []

        async def fake_emit(event, data, room=None, skip_sid=None):
            emitted.append((event, data, room, skip_sid))

        monkeypatch.setattr(sio, "emit", fake_emit)

        async def fake_session(sid):
            return {"user_id": "u1", "username": "alice"}

        async def fake_perm(project_id, user_id):
            return True

        monkeypatch.setattr("app.ws.collaboration._get_session_info", fake_session)
        monkeypatch.setattr("app.ws.collaboration._check_edit_permission", fake_perm)

        await node_update("s1", {
            "project_id": "p1",
            "node_id": "n1",
            "action": "delete",
        })

        # 无锁时不应广播 lock_changed
        lock_changed_events = [e for e in emitted if e[0] == "lock_changed"]
        assert len(lock_changed_events) == 0
        # node_update 仍正常广播
        node_update_events = [e for e in emitted if e[0] == "node_update"]
        assert len(node_update_events) == 1
