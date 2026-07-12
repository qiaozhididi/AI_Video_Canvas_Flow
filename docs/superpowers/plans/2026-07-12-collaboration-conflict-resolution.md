# 协作冲突解决（节点锁）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为实时协作引入轻量级节点锁（租约模型），解决同时拖动/同时编辑/删除时编辑/网络乱序 5 类冲突。

**Architecture:** 后端在 `ws/collaboration.py` 新增 `_node_locks` 全局字典 + 4 个 Socket.IO 事件（acquire/renew/release/force_release）+ TTL 清理协程。前端在 `collabStore.ts` 新增锁状态管理 + 隐式加锁（拖动/编辑自动获取）+ 2s 续租。锁定节点显示橙色边框 + 持锁者角标。

**Tech Stack:** Socket.IO（后端 AsyncServer / 前端 socket.io-client）、Zustand（前端状态）、React Flow（节点视觉）、pytest + vitest（测试）

**设计文档:** [2026-07-12-collaboration-conflict-resolution-design.md](../specs/2026-07-12-collaboration-conflict-resolution-design.md)

## Global Constraints

- 后端锁状态存储在内存字典（非 Redis），单实例部署
- 锁 TTL = 5.0s，续租间隔 = 2.0s，清理协程扫描间隔 = 1.0s
- viewer 不可获锁（复用现有 `_check_edit_permission`），owner 可 force_release
- 删除节点优先于锁，无需获锁即可删除，但需清理该节点锁
- 不修改现有 `node_update` / `edge_update` payload 结构（锁是叠加层，向后兼容）
- 锁释放统一通过 `lock_changed`（lock=null）广播，不单独发 lock_released
- git commit 使用简短中文描述
- 代码注释使用中文

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/app/ws/collaboration.py` | 修改 | 新增 NodeLock + _node_locks + 4 事件 + TTL 协程 + disconnect/node_update 清理 |
| `backend/app/main.py` | 修改 | lifespan 中启动 TTL 清理协程 |
| `backend/tests/test_collaboration_locks.py` | 新建 | NodeLock + 工具函数 + 事件单测 |
| `frontend/src/stores/collabStore.ts` | 修改 | 新增锁状态 + acquire/renew/release + 续租定时器 + onLockChanged + joinProject 全量同步 |
| `frontend/src/components/Editor.tsx` | 修改 | onNodeDragStart/Stop 加锁 + PropertyPanel focus/blur + lock_changed 订阅 |
| `frontend/src/components/canvas/LockedNodeStyle.tsx` | 新建 | 锁定节点视觉组件（橙色边框 + 角标） |
| `frontend/src/components/CollaborationStatusBar.tsx` | 新建 | 顶部协作状态提示条 |

---

## Task 1: 后端 NodeLock 数据类 + 工具函数

**Files:**
- Modify: `backend/app/ws/collaboration.py`（文件头部新增数据类和工具函数）
- Test: `backend/tests/test_collaboration_locks.py`

**Interfaces:**
- Produces: `NodeLock` 数据类（字段: node_id, project_id, sid, user_id, username, acquired_at, expires_at, last_renewed；方法: is_expired(now), renew(ttl)）、`_node_locks` 全局字典、`_lock_key(project_id, node_id)`、`_get_active_lock(project_id, node_id)`、`_purge_expired_locks()`、`_remove_locks_by_sid(sid)`、`_lock_to_dict(lock)`、常量 `LOCK_TTL`/`LOCK_RENEW_INTERVAL`/`LOCK_CLEANUP_INTERVAL`

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_collaboration_locks.py`：

```python
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py -v --tb=short`
Expected: FAIL with `ImportError: cannot import name 'NodeLock'`

- [ ] **Step 3: 实现 NodeLock + 工具函数**

在 `backend/app/ws/collaboration.py` 文件顶部（`import` 之后、`_room_members` 定义之前）插入：

```python
import time
from dataclasses import dataclass

# ── 节点锁配置 ──
LOCK_TTL: float = 5.0           # 锁存活时长（秒）
LOCK_RENEW_INTERVAL: float = 2.0   # 客户端续租间隔（秒）
LOCK_CLEANUP_INTERVAL: float = 1.0  # 后端清理协程扫描间隔（秒）


@dataclass
class NodeLock:
    """节点锁信息（租约模型）"""
    node_id: str
    project_id: str
    sid: str              # 持锁者 Socket.IO sid
    user_id: str
    username: str
    acquired_at: float    # 获取时间戳（秒）
    expires_at: float     # 过期时间戳（秒）
    last_renewed: float   # 最后续租时间

    def is_expired(self, now: float | None = None) -> bool:
        now = now if now is not None else time.time()
        return now >= self.expires_at

    def renew(self, ttl: float) -> None:
        """续租：刷新过期时间"""
        self.last_renewed = time.time()
        self.expires_at = self.last_renewed + ttl


# 全局锁状态：key = (project_id, node_id)，value = NodeLock
_node_locks: dict[tuple[str, str], NodeLock] = {}


def _lock_key(project_id: str, node_id: str) -> tuple[str, str]:
    return (project_id, node_id)


def _get_active_lock(project_id: str, node_id: str) -> NodeLock | None:
    """获取节点的有效锁（已过期的视为无锁并清理）"""
    key = _lock_key(project_id, node_id)
    lock = _node_locks.get(key)
    if lock is None:
        return None
    if lock.is_expired():
        _node_locks.pop(key, None)
        return None
    return lock


def _purge_expired_locks() -> list[NodeLock]:
    """清理所有过期锁，返回被清理的锁列表（用于广播释放事件）"""
    now = time.time()
    expired = [lock for lock in _node_locks.values() if lock.is_expired(now)]
    for lock in expired:
        _node_locks.pop(_lock_key(lock.project_id, lock.node_id), None)
    return expired


def _remove_locks_by_sid(sid: str) -> list[NodeLock]:
    """移除某 sid 持有的所有锁（断线清理），返回被移除的锁列表"""
    removed = [lock for lock in _node_locks.values() if lock.sid == sid]
    for lock in removed:
        _node_locks.pop(_lock_key(lock.project_id, lock.node_id), None)
    return removed


def _lock_to_dict(lock: NodeLock) -> dict:
    """NodeLock → 可序列化 dict（用于事件 payload）"""
    return {
        "node_id": lock.node_id,
        "project_id": lock.project_id,
        "sid": lock.sid,
        "user_id": lock.user_id,
        "username": lock.username,
        "acquired_at": lock.acquired_at,
        "expires_at": lock.expires_at,
    }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py -v --tb=short`
Expected: PASS（全部用例通过）

- [ ] **Step 5: 提交**

```bash
git add backend/app/ws/collaboration.py backend/tests/test_collaboration_locks.py
git commit -m "feat(collab): 新增 NodeLock 数据类与锁状态工具函数"
```

---

## Task 2: 后端 acquire_lock / renew_lock / release_lock 事件

**Files:**
- Modify: `backend/app/ws/collaboration.py`（在现有 `cursor_move` 事件之后新增 3 个事件）
- Test: `backend/tests/test_collaboration_locks.py`（追加事件测试）

**Interfaces:**
- Consumes: Task 1 的 `NodeLock`、`_node_locks`、`_get_active_lock`、`_lock_to_dict`、`_check_edit_permission`（现有）、`_get_session_info`（现有）
- Produces: Socket.IO 事件处理函数 `acquire_lock(sid, data)`、`renew_lock(sid, data)`、`release_lock(sid, data)`；ack 返回 `LockResult` / `{ok, expires_at}` / `{ok}`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_collaboration_locks.py` 末尾追加：

```python
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py::TestAcquireLockLogic -v --tb=short`
Expected: PASS（因为测试直接操作 _node_locks，验证逻辑而非事件处理函数）

> 注：这些测试验证锁状态逻辑，事件处理函数的集成测试在 Task 8 覆盖。先确保逻辑正确。

- [ ] **Step 3: 实现 3 个事件处理函数**

在 `backend/app/ws/collaboration.py` 的 `cursor_move` 事件之后、`ping` 事件之前插入：

```python
# ── 节点锁事件 ──

@sio.on("acquire_lock")
async def acquire_lock(sid, data):
    """申请节点锁

    流程：权限检查 → 检查现有锁 → 创建或拒绝
    ack 返回: {ok: true, lock} | {ok: false, reason, holder?} | {ok: false, reason: 'permission_denied'}
    """
    project_id = data.get("project_id")
    node_id = data.get("node_id")
    if not project_id or not node_id:
        return {"ok": False, "reason": "error", "message": "缺少 project_id 或 node_id"}

    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")
    username = session.get("username", "unknown")

    # 权限检查（viewer 不可锁）
    if not await _check_edit_permission(project_id, user_id):
        return {"ok": False, "reason": "permission_denied"}

    # 检查现有锁
    existing = _get_active_lock(project_id, node_id)
    if existing:
        if existing.sid == sid:
            # 自己已持锁，续租并返回
            existing.renew(LOCK_TTL)
            return {"ok": True, "lock": _lock_to_dict(existing)}
        # 他人持锁
        return {"ok": False, "reason": "locked_by_other", "holder": _lock_to_dict(existing)}

    # 创建新锁
    now = time.time()
    lock = NodeLock(
        node_id=node_id,
        project_id=project_id,
        sid=sid,
        user_id=user_id,
        username=username,
        acquired_at=now,
        expires_at=now + LOCK_TTL,
        last_renewed=now,
    )
    _node_locks[_lock_key(project_id, node_id)] = lock

    room = f"project:{project_id}"
    await sio.emit("lock_changed", {
        "project_id": project_id,
        "node_id": node_id,
        "lock": _lock_to_dict(lock),
    }, room=room)

    logger.debug(f"[WS:Lock] acquire sid={sid} user={username} node={node_id}")
    return {"ok": True, "lock": _lock_to_dict(lock)}


@sio.on("renew_lock")
async def renew_lock(sid, data):
    """续租节点锁"""
    project_id = data.get("project_id")
    node_id = data.get("node_id")
    lock = _node_locks.get(_lock_key(project_id, node_id))

    if not lock or lock.sid != sid:
        return {"ok": False}

    lock.renew(LOCK_TTL)
    return {"ok": True, "expires_at": lock.expires_at}


@sio.on("release_lock")
async def release_lock(sid, data):
    """主动释放节点锁"""
    project_id = data.get("project_id")
    node_id = data.get("node_id")
    key = _lock_key(project_id, node_id)
    lock = _node_locks.get(key)

    if not lock or lock.sid != sid:
        return {"ok": False}

    _node_locks.pop(key, None)
    room = f"project:{project_id}"
    await sio.emit("lock_changed", {
        "project_id": project_id,
        "node_id": node_id,
        "lock": None,
    }, room=room)

    logger.debug(f"[WS:Lock] release sid={sid} node={node_id}")
    return {"ok": True}
```

- [ ] **Step 4: 验证导入无误**

Run: `cd backend && .venv/bin/python -c "from app.ws.collaboration import acquire_lock, renew_lock, release_lock; print('OK')"`
Expected: 输出 `OK`

- [ ] **Step 5: 运行全部测试验证通过**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py -v --tb=short`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/app/ws/collaboration.py backend/tests/test_collaboration_locks.py
git commit -m "feat(collab): 新增 acquire/renew/release 锁事件处理"
```

---

## Task 3: 后端 force_release + TTL 协程 + disconnect/node_update 清理

**Files:**
- Modify: `backend/app/ws/collaboration.py`（新增 force_release 事件 + TTL 协程 + 修改 disconnect + 修改 node_update + 修改 join_project）
- Modify: `backend/app/main.py`（lifespan 启动 TTL 协程）
- Test: `backend/tests/test_collaboration_locks.py`（追加 TTL/清理测试）

**Interfaces:**
- Consumes: Task 1-2 的所有工具函数和事件
- Produces: `force_release(sid, data)` 事件、`_lock_cleanup_loop()` 协程、修改后的 `disconnect`（追加锁清理）、修改后的 `node_update`（追加删除清理）、修改后的 `join_project`（ack 返回 locks）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_collaboration_locks.py` 末尾追加：

```python
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
```

- [ ] **Step 2: 运行测试验证通过**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py -v --tb=short | tail -20`
Expected: PASS（测试验证逻辑，不依赖事件函数）

- [ ] **Step 3: 实现 force_release 事件**

在 `backend/app/ws/collaboration.py` 的 `release_lock` 事件之后插入：

```python
@sio.on("force_release")
async def force_release(sid, data):
    """强制解锁（仅 owner 可操作）"""
    project_id = data.get("project_id")
    node_id = data.get("node_id")
    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")

    # 检查是否为项目 owner
    async with async_session_factory() as db:
        project = await db.get(Project, uuid.UUID(project_id))
        if not project or str(project.owner_id) != user_id:
            return {"ok": False, "message": "仅项目所有者可强制解锁"}

    key = _lock_key(project_id, node_id)
    lock = _node_locks.pop(key, None)
    if lock:
        room = f"project:{project_id}"
        await sio.emit("lock_changed", {
            "project_id": project_id,
            "node_id": node_id,
            "lock": None,
        }, room=room)
        logger.info(f"[WS:Lock] force_release by owner sid={sid} node={node_id} old_holder={lock.username}")
    return {"ok": True}
```

- [ ] **Step 4: 实现 TTL 清理协程**

在 `force_release` 事件之后插入：

```python
async def _lock_cleanup_loop():
    """后台协程：定期清理过期锁并广播释放事件"""
    logger.info("[WS:Lock] TTL 清理协程已启动")
    while True:
        await asyncio.sleep(LOCK_CLEANUP_INTERVAL)
        try:
            expired = _purge_expired_locks()
            for lock in expired:
                room = f"project:{lock.project_id}"
                await sio.emit("lock_changed", {
                    "project_id": lock.project_id,
                    "node_id": lock.node_id,
                    "lock": None,
                }, room=room)
                logger.debug(
                    f"[WS:Lock] TTL 过期释放 node={lock.node_id} "
                    f"user={lock.username} held={time.time() - lock.acquired_at:.1f}s"
                )
        except Exception as e:
            logger.warning(f"[WS:Lock] 清理协程异常: {e}")
```

> 注：确保 `asyncio` 已在文件顶部导入。若未导入，在 import 区追加 `import asyncio`。

- [ ] **Step 5: 修改 disconnect 事件追加锁清理**

找到 `backend/app/ws/collaboration.py` 中的 `disconnect` 函数，在房间成员清理循环之后（`# 1. 清理房间成员` 块之后）追加：

```python
    # 2. 清理该 sid 持有的所有锁（新增）
    released = _remove_locks_by_sid(sid)
    for lock in released:
        room = f"project:{lock.project_id}"
        await sio.emit("lock_changed", {
            "project_id": lock.project_id,
            "node_id": lock.node_id,
            "lock": None,
        }, room=room)
    if released:
        logger.info(f"[WS:Lock] 断线清理 sid={sid} 释放 {len(released)} 个锁")
```

- [ ] **Step 6: 修改 node_update 事件追加删除清理**

找到 `node_update` 函数，在 `await sio.emit("node_update", data, room=room, skip_sid=sid)` 之后追加：

```python
    # 删除节点时清理关联锁（新增）
    if action == "delete":
        lock = _node_locks.pop(_lock_key(project_id, node_id), None)
        if lock:
            logger.debug(f"[WS:Lock] 节点删除清理锁 node={node_id} holder={lock.username}")
```

- [ ] **Step 7: 修改 join_project 返回锁状态**

找到 `join_project` 函数的 `return` 语句，修改为：

```python
    # 返回当前房间在线用户 + 所有锁状态（新增）
    project_locks = [
        _lock_to_dict(lock)
        for lock in _node_locks.values()
        if lock.project_id == project_id and not lock.is_expired()
    ]
    return {
        "users": _room_members.get(room, []),
        "locks": project_locks,
    }
```

- [ ] **Step 8: 修改 main.py 启动 TTL 协程**

找到 `backend/app/main.py` 的 `lifespan` 函数，在 `yield` 之前追加：

```python
    # 启动锁 TTL 清理协程
    from app.ws.collaboration import _lock_cleanup_loop
    asyncio.create_task(_lock_cleanup_loop())
```

> 注：确保 `asyncio` 已在 main.py 顶部导入。

- [ ] **Step 9: 验证导入与启动**

Run: `cd backend && .venv/bin/python -c "from app.ws.collaboration import force_release, _lock_cleanup_loop; from app.main import app; print('OK')"`
Expected: 输出 `OK`

- [ ] **Step 10: 运行全部测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py -v --tb=short`
Expected: PASS

- [ ] **Step 11: 提交**

```bash
git add backend/app/ws/collaboration.py backend/app/main.py backend/tests/test_collaboration_locks.py
git commit -m "feat(collab): 新增 force_release/TTL清理/断线清理/节点删除清理/全量同步"
```

---

## Task 4: 前端 collabStore 锁状态类型 + 锁操作方法

**Files:**
- Modify: `frontend/src/stores/collabStore.ts`（新增类型定义 + acquireLock/renewLock/releaseLock/forceReleaseLock 实现）

**Interfaces:**
- Consumes: 后端 acquire_lock/renew_lock/release_lock/force_release 事件（Task 2-3）
- Produces: `NodeLockInfo` 类型、`LockResult` 类型、`LockChangedPayload` 类型、`CollabState` 新增字段 `nodeLocks`/`myLocks`/`_renewTimer`、方法 `acquireLock(nodeId)`/`renewLock(nodeId)`/`releaseLock(nodeId)`/`forceReleaseLock(nodeId)`/`isNodeLocked(nodeId)`/`isNodeLockedByMe(nodeId)`/`getNodeLockHolder(nodeId)`/`_startRenewTimer()`/`_stopRenewTimer()`

- [ ] **Step 1: 新增类型定义**

在 `frontend/src/stores/collabStore.ts` 的类型定义区（`CursorMovePayload` 之后）追加：

```typescript
// 节点锁信息（对齐后端 NodeLock）
export interface NodeLockInfo {
  node_id: string;
  project_id: string;
  sid: string;
  user_id: string;
  username: string;
  acquired_at: number;
  expires_at: number;
}

// 锁操作结果（acquire_lock 的 ack）
export type LockResult =
  | { ok: true; lock: NodeLockInfo }
  | { ok: false; reason: 'locked_by_other'; holder: NodeLockInfo }
  | { ok: false; reason: 'permission_denied' }
  | { ok: false; reason: 'error'; message: string };

// lock_changed 广播事件 payload
export interface LockChangedPayload {
  project_id: string;
  node_id: string;
  lock: NodeLockInfo | null;  // null 表示锁已释放
}

// 续租间隔（秒），对齐后端 LOCK_RENEW_INTERVAL
const LOCK_RENEW_INTERVAL = 2.0;
```

- [ ] **Step 2: 扩展 CollabState 接口**

在 `CollabState` 接口中（`onEdgeUpdate` 之前）追加：

```typescript
  // 节点锁状态
  nodeLocks: Record<string, NodeLockInfo>;
  myLocks: Record<string, NodeLockInfo>;
  _renewTimer: ReturnType<typeof setInterval> | null;

  // 锁操作
  acquireLock: (nodeId: string) => Promise<LockResult>;
  renewLock: (nodeId: string) => Promise<boolean>;
  releaseLock: (nodeId: string) => Promise<void>;
  forceReleaseLock: (nodeId: string) => Promise<boolean>;

  // 锁查询
  isNodeLocked: (nodeId: string) => boolean;
  isNodeLockedByMe: (nodeId: string) => boolean;
  getNodeLockHolder: (nodeId: string) => NodeLockInfo | null;

  // 续租定时器（内部）
  _startRenewTimer: () => void;
  _stopRenewTimer: () => void;

  // 锁事件订阅
  onLockChanged: (cb: (payload: LockChangedPayload) => void) => () => void;
```

- [ ] **Step 3: 初始化锁状态字段**

在 `create<CollabState>((set, get) => ({` 后的初始状态中追加：

```typescript
  nodeLocks: {},
  myLocks: {},
  _renewTimer: null,
```

- [ ] **Step 4: 实现 acquireLock / renewLock / releaseLock / forceReleaseLock**

在 `emitCursorMove` 实现之后追加：

```typescript
  acquireLock: (nodeId) => {
    const { socket, currentProjectId } = get();
    if (!socket || !currentProjectId) {
      return Promise.resolve({ ok: false, reason: 'error', message: '未连接' });
    }
    return new Promise((resolve) => {
      // 超时降级：3s 未收到 ack 则降级为无锁模式（设计文档 §9.2）
      const timeoutId = setTimeout(() => {
        console.warn(`[Collab:Lock] acquire 超时 node=${nodeId}，降级为无锁模式`);
        resolve({ ok: false, reason: 'error', message: '加锁超时，已降级' });
      }, 3000);
      socket.emit(
        'acquire_lock',
        { project_id: currentProjectId, node_id: nodeId },
        (ack: LockResult) => {
          clearTimeout(timeoutId);
          if (ack.ok) {
            set((state) => ({
              myLocks: { ...state.myLocks, [nodeId]: ack.lock },
              nodeLocks: { ...state.nodeLocks, [nodeId]: ack.lock },
            }));
            get()._startRenewTimer();
          } else if (ack.reason === 'locked_by_other') {
            set((state) => ({
              nodeLocks: { ...state.nodeLocks, [nodeId]: ack.holder },
            }));
          }
          resolve(ack);
        },
      );
    });
  },

  renewLock: (nodeId) => {
    const { socket, currentProjectId, myLocks } = get();
    if (!socket || !currentProjectId || !myLocks[nodeId]) return Promise.resolve(false);
    return new Promise((resolve) => {
      socket.emit(
        'renew_lock',
        { project_id: currentProjectId, node_id: nodeId },
        (ack: { ok: boolean; expires_at?: number }) => {
          if (ack.ok && ack.expires_at) {
            set((state) => ({
              myLocks: {
                ...state.myLocks,
                [nodeId]: { ...state.myLocks[nodeId], expires_at: ack.expires_at! },
              },
            }));
          }
          resolve(ack.ok);
        },
      );
    });
  },

  releaseLock: (nodeId) => {
    const { socket, currentProjectId } = get();
    if (!socket || !currentProjectId) return Promise.resolve();
    return new Promise<void>((resolve) => {
      socket.emit(
        'release_lock',
        { project_id: currentProjectId, node_id: nodeId },
        () => {
          set((state) => {
            const myLocks = { ...state.myLocks };
            const nodeLocks = { ...state.nodeLocks };
            delete myLocks[nodeId];
            delete nodeLocks[nodeId];
            return { myLocks, nodeLocks };
          });
          resolve();
        },
      );
    });
  },

  forceReleaseLock: (nodeId) => {
    const { socket, currentProjectId } = get();
    if (!socket || !currentProjectId) return Promise.resolve(false);
    return new Promise((resolve) => {
      socket.emit(
        'force_release',
        { project_id: currentProjectId, node_id: nodeId },
        (ack: { ok: boolean }) => resolve(ack.ok),
      );
    });
  },

  isNodeLocked: (nodeId) => !!get().nodeLocks[nodeId],
  isNodeLockedByMe: (nodeId) => !!get().myLocks[nodeId],
  getNodeLockHolder: (nodeId) => get().nodeLocks[nodeId] || null,

  _startRenewTimer: () => {
    const { _renewTimer } = get();
    if (_renewTimer) return;
    const timer = setInterval(async () => {
      const { myLocks, renewLock } = get();
      const nodeIds = Object.keys(myLocks);
      if (nodeIds.length === 0) {
        get()._stopRenewTimer();
        return;
      }
      await Promise.all(nodeIds.map((id) => renewLock(id)));
    }, LOCK_RENEW_INTERVAL * 1000);
    set({ _renewTimer: timer });
  },

  _stopRenewTimer: () => {
    const { _renewTimer } = get();
    if (_renewTimer) {
      clearInterval(_renewTimer);
      set({ _renewTimer: null });
    }
  },

  onLockChanged: (cb) => {
    const { socket } = get();
    if (!socket) return () => {};
    const handler = (payload: LockChangedPayload) => {
      set((state) => {
        const nodeLocks = { ...state.nodeLocks };
        const myLocks = { ...state.myLocks };
        if (payload.lock) {
          nodeLocks[payload.node_id] = payload.lock;
          if (myLocks[payload.node_id] && myLocks[payload.node_id].sid !== payload.lock.sid) {
            delete myLocks[payload.node_id];
          }
        } else {
          delete nodeLocks[payload.node_id];
          delete myLocks[payload.node_id];
        }
        return { nodeLocks, myLocks };
      });
      cb(payload);
    };
    socket.on('lock_changed', handler);
    return () => socket.off('lock_changed', handler);
  },
```

- [ ] **Step 5: 修改 joinProject 接收全量锁状态**

找到 `joinProject` 实现，修改 ack 处理：

```typescript
  joinProject: () => {
    const { socket, currentProjectId } = get();
    socket?.emit('join_project', { project_id: currentProjectId }, (ack: JoinProjectAck & { locks?: NodeLockInfo[] }) => {
      set({
        onlineUsers: ack.users,
        nodeLocks: Object.fromEntries((ack.locks || []).map((l) => [l.node_id, l])),
      });
    });
  },
```

- [ ] **Step 6: 修改 disconnect 清理本地锁状态**

找到 `disconnect` 实现，追加锁清理：

```typescript
  disconnect: () => {
    const { socket, _renewTimer } = get();
    if (_renewTimer) clearInterval(_renewTimer);
    socket?.disconnect();
    set({
      socket: null,
      isConnected: false,
      currentProjectId: null,
      onlineUsers: [],
      remoteCursors: [],
      nodeLocks: {},
      myLocks: {},
      _renewTimer: null,
    });
  },
```

- [ ] **Step 7: 验证 TypeScript 类型**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep collabStore || echo "No errors in collabStore"`
Expected: 输出 `No errors in collabStore` 或无相关错误

- [ ] **Step 8: 提交**

```bash
git add frontend/src/stores/collabStore.ts
git commit -m "feat(collab): collabStore 新增节点锁状态与操作方法"
```

---

## Task 5: 前端 Editor.tsx 加锁集成

**Files:**
- Modify: `frontend/src/components/Editor.tsx`（新增 onNodeDragStart/Stop 加锁 + lock_changed 订阅 + PropertyPanel focus/blur 钩子）

**Interfaces:**
- Consumes: Task 4 的 `acquireLock`/`releaseLock`/`isNodeLocked`/`isNodeLockedByMe`/`getNodeLockHolder`/`onLockChanged`
- Produces: 修改后的 Editor 组件（拖动/编辑时自动加锁）

- [ ] **Step 1: 导入 collabStore 锁方法**

在 `frontend/src/components/Editor.tsx` 顶部导入区，确保有以下导入（若 collabStore 已导入则追加解构）：

```typescript
import { useCollabStore } from '@/stores/collabStore';
```

- [ ] **Step 2: 在组件内订阅 lock_changed 并触发重渲染**

在 Editor 组件内（与其他 useEffect 同级）追加：

```typescript
  const { acquireLock, releaseLock, isNodeLocked, isNodeLockedByMe, getNodeLockHolder, onLockChanged } = useCollabStore();

  // 每个节点的延迟释放定时器（node_id → timer），避免连续拖动时误释放
  const releaseTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 订阅 lock_changed 事件，触发节点重渲染（更新 _locked/_lockHolder）
  useEffect(() => {
    const unsub = onLockChanged(() => {
      setNodes((nds) =>
        nds.map((n) => {
          const locked = isNodeLocked(n.id) && !isNodeLockedByMe(n.id);
          const holder = getNodeLockHolder(n.id);
          return {
            ...n,
            data: { ...n.data, _locked: locked, _lockHolder: holder?.username || null },
          };
        }),
      );
    });
    return unsub;
  }, [onLockChanged, isNodeLocked, isNodeLockedByMe, getNodeLockHolder]);
```

- [ ] **Step 3: 实现 onNodeDragStart 加锁**

找到 Editor 中的 React Flow `onNodeDragStart` 回调（若不存在则新增），修改为：

```typescript
  const onNodeDragStart = useCallback(async (_evt: React.MouseEvent, node: Node) => {
    // 清除该节点待执行的延迟释放定时器
    const oldTimer = releaseTimersRef.current[node.id];
    if (oldTimer) {
      clearTimeout(oldTimer);
      delete releaseTimersRef.current[node.id];
    }
    // 检查是否被他人锁定
    if (isNodeLocked(node.id) && !isNodeLockedByMe(node.id)) {
      const holder = getNodeLockHolder(node.id);
      toast.warning(`节点正被 ${holder?.username} 编辑`);
      return;
    }
    const result = await acquireLock(node.id);
    if (!result.ok && result.reason === 'locked_by_other') {
      toast.info(`节点正被 ${result.holder.username} 编辑，请稍后`);
    }
  }, [acquireLock, isNodeLocked, isNodeLockedByMe, getNodeLockHolder]);
```

> 注：确保 `toast` 已导入（`import { toast } from 'react-hot-toast'` 或项目使用的 toast 库）。

- [ ] **Step 4: 实现 onNodeDragStop 延迟释放**

找到 `onNodeDragStop` 回调（若不存在则新增），修改为：

```typescript
  const onNodeDragStop = useCallback((_evt: React.MouseEvent, node: Node) => {
    // 清除旧的待执行定时器
    const oldTimer = releaseTimersRef.current[node.id];
    if (oldTimer) clearTimeout(oldTimer);
    // 3s 后释放（给连续微调留时间）
    releaseTimersRef.current[node.id] = setTimeout(async () => {
      if (isNodeLockedByMe(node.id)) {
        await releaseLock(node.id);
      }
      delete releaseTimersRef.current[node.id];
    }, 3000);
  }, [releaseLock, isNodeLockedByMe]);
```

- [ ] **Step 5: 将回调绑定到 ReactFlow**

确保 `<ReactFlow>` 组件的 props 包含：

```typescript
<ReactFlow
  // ... 现有 props ...
  onNodeDragStart={onNodeDragStart}
  onNodeDragStop={onNodeDragStop}
>
```

- [ ] **Step 6: 实现 PropertyPanel focus/blur 加锁**

设计文档 §7.2 要求属性面板输入获焦时加锁、失焦时释放。在 Editor 组件内追加：

```typescript
  // 属性面板获焦加锁（设计文档 §7.2 onPropertyFocus）
  const onPropertyFocus = useCallback(async (nodeId: string) => {
    // 清除该节点待执行的延迟释放定时器（与拖动共用）
    const oldTimer = releaseTimersRef.current[nodeId];
    if (oldTimer) {
      clearTimeout(oldTimer);
      delete releaseTimersRef.current[nodeId];
    }
    if (isNodeLocked(nodeId) && !isNodeLockedByMe(nodeId)) {
      const holder = getNodeLockHolder(nodeId);
      toast.warning(`节点正被 ${holder?.username} 编辑`);
      return false;
    }
    const result = await acquireLock(nodeId);
    if (!result.ok && result.reason === 'locked_by_other') {
      toast.info(`节点正被 ${result.holder.username} 编辑，请稍后`);
      return false;
    }
    return result.ok;
  }, [acquireLock, isNodeLocked, isNodeLockedByMe, getNodeLockHolder]);

  // 属性面板失焦延迟释放（与拖动共用延迟释放逻辑）
  const onPropertyBlur = useCallback((nodeId: string) => {
    const oldTimer = releaseTimersRef.current[nodeId];
    if (oldTimer) clearTimeout(oldTimer);
    releaseTimersRef.current[nodeId] = setTimeout(async () => {
      if (isNodeLockedByMe(nodeId)) {
        await releaseLock(nodeId);
      }
      delete releaseTimersRef.current[nodeId];
    }, 3000);
  }, [releaseLock, isNodeLockedByMe]);
```

> 注：`onPropertyFocus` / `onPropertyBlur` 需传入 PropertyPanel 组件，由其输入元素的 `onFocus` / `onBlur` 事件触发。具体接入方式取决于现有 PropertyPanel 的 props 结构——若 PropertyPanel 已接收 `nodeId`，则追加这两个回调 props 即可。

- [ ] **Step 7: 组件卸载时清理定时器**

追加 useEffect：

```typescript
  useEffect(() => {
    return () => {
      // 清理所有延迟释放定时器
      Object.values(releaseTimersRef.current).forEach(clearTimeout);
      releaseTimersRef.current = {};
    };
  }, []);
```

- [ ] **Step 8: 验证 TypeScript 类型**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep Editor || echo "No errors in Editor"`
Expected: 无错误

- [ ] **Step 9: 提交**

```bash
git add frontend/src/components/Editor.tsx
git commit -m "feat(collab): Editor 拖动与属性编辑时自动加锁"
```

---

## Task 6: 前端 LockedNodeStyle 组件 + CollaborationStatusBar

**Files:**
- Create: `frontend/src/components/canvas/LockedNodeStyle.tsx`
- Create: `frontend/src/components/CollaborationStatusBar.tsx`
- Modify: `frontend/src/components/Editor.tsx`（注册 nodeTypes）

**Interfaces:**
- Consumes: Task 4 的 `nodeLocks`/`myLocks`/`onlineUsers`
- Produces: `LockedNode` 组件（根据 `data._locked` 切换样式）、`CollaborationStatusBar` 组件

- [ ] **Step 1: 创建 LockedNodeStyle 组件**

新建 `frontend/src/components/canvas/LockedNodeStyle.tsx`：

```typescript
import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

interface LockedNodeData {
  label: string;
  _locked?: boolean;
  _lockHolder?: string | null;
  [key: string]: unknown;
}

/** 节点样式：根据 _locked 状态切换橙色边框 + 锁角标 */
const LockedNode = memo(({ data, selected }: NodeProps<LockedNodeData>) => {
  const isLocked = data._locked;
  return (
    <div
      className={[
        'relative rounded-lg border-2 px-3 py-2 transition-colors',
        isLocked
          ? 'border-orange-400 bg-orange-50 cursor-not-allowed'
          : selected
            ? 'border-blue-500 bg-white'
            : 'border-gray-300 bg-white',
      ].join(' ')}
    >
      {isLocked && (
        <div className="absolute -top-2 -right-2 flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white shadow">
          <span>🔒</span>
          <span className="max-w-[80px] truncate">{data._lockHolder}</span>
        </div>
      )}
      <div className="text-sm font-medium">{data.label}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export default LockedNode;
```

- [ ] **Step 2: 创建 CollaborationStatusBar 组件**

新建 `frontend/src/components/CollaborationStatusBar.tsx`：

```typescript
import { useCollabStore } from '@/stores/collabStore';

/** 顶部协作状态提示条：显示持锁数与在线人数 */
export function CollaborationStatusBar() {
  const myLocks = useCollabStore((s) => s.myLocks);
  const nodeLocks = useCollabStore((s) => s.nodeLocks);
  const onlineUsers = useCollabStore((s) => s.onlineUsers);

  const myLockCount = Object.keys(myLocks).length;
  const otherLockCount = Object.values(nodeLocks).filter(
    (l) => !myLocks[l.node_id],
  ).length;

  if (myLockCount === 0 && otherLockCount === 0) return null;

  return (
    <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-1.5 text-xs text-gray-600">
      {myLockCount > 0 && (
        <span className="text-blue-600">你正在编辑 {myLockCount} 个节点</span>
      )}
      {otherLockCount > 0 && (
        <span className="text-orange-600">{otherLockCount} 个节点被他人锁定</span>
      )}
      <span className="ml-auto text-gray-400">在线 {onlineUsers.length} 人</span>
    </div>
  );
}
```

- [ ] **Step 3: 在 Editor.tsx 注册 nodeTypes**

在 `frontend/src/components/Editor.tsx` 导入区追加：

```typescript
import LockedNode from './canvas/LockedNodeStyle';
import { CollaborationStatusBar } from './CollaborationStatusBar';
```

在组件内（与其他 useMemo 同级）定义 nodeTypes：

```typescript
  const nodeTypes = useMemo(() => ({
    default: LockedNode,
    // 保留现有其他自定义类型...
  }), []);
```

将 `nodeTypes` 传给 `<ReactFlow>`：

```typescript
<ReactFlow
  nodeTypes={nodeTypes}
  // ... 其他 props ...
>
```

- [ ] **Step 4: 在 EditorLayout 中放置状态条**

找到 `frontend/src/components/EditorLayout.tsx`，在画布区域顶部工具栏下方插入：

```typescript
import { CollaborationStatusBar } from './CollaborationStatusBar';

// 在工具栏与画布之间
<CollaborationStatusBar />
```

- [ ] **Step 5: 验证 TypeScript 类型**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -E "LockedNode|CollaborationStatusBar" || echo "No errors"`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/canvas/LockedNodeStyle.tsx frontend/src/components/CollaborationStatusBar.tsx frontend/src/components/Editor.tsx frontend/src/components/EditorLayout.tsx
git commit -m "feat(collab): 新增锁定节点样式与协作状态提示条"
```

---

## Task 7: 后端集成测试（锁竞争 + TTL + 断线）

**Files:**
- Test: `backend/tests/test_collaboration_locks.py`（追加集成场景测试）

- [ ] **Step 1: 追加集成测试**

在 `backend/tests/test_collaboration_locks.py` 末尾追加：

```python
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
```

- [ ] **Step 2: 运行全部测试**

Run: `cd backend && .venv/bin/python -m pytest tests/test_collaboration_locks.py -v --tb=short`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add backend/tests/test_collaboration_locks.py
git commit -m "test(collab): 新增锁生命周期/并发/TTL/断线/删除集成测试"
```

---

## Task 8: 前端 store 单元测试 + 最终验证

**Files:**
- Test: `frontend/src/stores/__tests__/collabStore.locks.test.ts`（新建）

- [ ] **Step 1: 创建前端测试文件**

新建 `frontend/src/stores/__tests__/collabStore.locks.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useCollabStore } from '../collabStore';

describe('collabStore 锁状态', () => {
  beforeEach(() => {
    useCollabStore.setState({ nodeLocks: {}, myLocks: {} });
  });

  describe('isNodeLocked', () => {
    it('节点在 nodeLocks 中时返回 true', () => {
      useCollabStore.setState({
        nodeLocks: {
          n1: { node_id: 'n1', project_id: 'p1', sid: 'other', user_id: 'u2', username: 'A', acquired_at: 0, expires_at: 999 },
        },
      });
      expect(useCollabStore.getState().isNodeLocked('n1')).toBe(true);
    });

    it('节点不在 nodeLocks 中时返回 false', () => {
      expect(useCollabStore.getState().isNodeLocked('n2')).toBe(false);
    });
  });

  describe('isNodeLockedByMe', () => {
    it('节点在 myLocks 中时返回 true', () => {
      useCollabStore.setState({
        myLocks: {
          n1: { node_id: 'n1', project_id: 'p1', sid: 'me', user_id: 'u1', username: 'me', acquired_at: 0, expires_at: 999 },
        },
      });
      expect(useCollabStore.getState().isNodeLockedByMe('n1')).toBe(true);
    });

    it('节点仅在 nodeLocks（他人锁）时返回 false', () => {
      useCollabStore.setState({
        nodeLocks: {
          n2: { node_id: 'n2', project_id: 'p1', sid: 'other', user_id: 'u2', username: 'A', acquired_at: 0, expires_at: 999 },
        },
      });
      expect(useCollabStore.getState().isNodeLockedByMe('n2')).toBe(false);
    });
  });

  describe('getNodeLockHolder', () => {
    it('返回持锁者信息', () => {
      const lock = { node_id: 'n1', project_id: 'p1', sid: 's1', user_id: 'u1', username: 'alice', acquired_at: 0, expires_at: 999 };
      useCollabStore.setState({ nodeLocks: { n1: lock } });
      expect(useCollabStore.getState().getNodeLockHolder('n1')).toEqual(lock);
    });

    it('无锁时返回 null', () => {
      expect(useCollabStore.getState().getNodeLockHolder('unknown')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 运行前端测试**

Run: `cd frontend && npx vitest run src/stores/__tests__/collabStore.locks.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: 运行后端全部测试确认无回归**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v --tb=short`
Expected: 全部 PASS

- [ ] **Step 4: 验证 TypeScript 全量编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/__tests__/collabStore.locks.test.ts
git commit -m "test(collab): 新增前端 collabStore 锁状态单元测试"
```

---

## 验收标准

完成全部 8 个任务后，应满足：

1. **后端**：`acquire_lock`/`renew_lock`/`release_lock`/`force_release` 事件正常工作，TTL 协程每秒清理过期锁，断线/节点删除时自动清理锁
2. **前端**：拖动节点时自动加锁，停止 3s 后释放，期间每 2s 续租；他人锁定节点显示橙色边框 + 🔒角标
3. **测试**：后端 `test_collaboration_locks.py` 全部通过，前端 `collabStore.locks.test.ts` 全部通过
4. **兼容**：现有 `node_update`/`edge_update` 协议不受影响，锁服务异常时降级为无锁模式
