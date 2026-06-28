"""Task 6 端到端验证脚本：后端 Socket.IO 完整协作流程

覆盖验收点（在 verify_task1 基础上扩展广播验证）：

鉴权：
  1. 无 token 连接被拒
  2. 无效 token 连接被拒
  3. 有效 token 连接成功（A、B）

房间与在线用户：
  4. A join_project，ack 返回用户列表（1 人）
  5. B join_project，ack 返回用户列表（2 人）
  6. A 收到 user_joined 事件（B 加入）

操作广播（Task 1 脚本未覆盖）：
  7. A emit node_update，B 收到 node_update 事件
  8. A emit edge_update，B 收到 edge_update 事件
  9. A emit cursor_move，B 收到 cursor_move 事件（含 sid）
  10. A 不收到自己 emit 的事件（skip_sid 验证）

离开：
  11. B leave_project，A 收到 user_left 事件
  12. B disconnect 后从 _room_members 移除（通过新 C join 验证）

运行方式：cd backend && .venv/bin/python verify_task6.py
前置条件：
  - 后端 uvicorn 服务运行在 localhost:8000
  - 已安装 websocket-client（用于 websocket transport，polling 模式 disconnect 不触发清理）
"""

import sys
import threading
import time
import uuid

import httpx
import socketio

BASE_URL = "http://localhost:8000"
WS_URL = "http://localhost:8000"
SIO_PATH = "socket.io"
TEST_PROJECT = f"verify-task6-{uuid.uuid4().hex[:8]}"

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name}" + (f" — {detail}" if detail else ""))


def get_token(username: str, password: str) -> str:
    """注册（已存在则忽略）+ 登录，返回 access_token"""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        c.post(
            "/api/v1/auth/register",
            json={"username": username, "email": f"{username}@test.local", "password": password},
        )
        r = c.post("/api/v1/auth/login", json={"username": username, "password": password})
        r.raise_for_status()
        return r.json()["access_token"]


def new_client() -> socketio.Client:
    return socketio.Client(logger=False, engineio_logger=False, reconnection=False)


def connect_with_token(c: socketio.Client, token: str | None) -> None:
    url = f"{WS_URL}?token={token}" if token else WS_URL
    c.connect(url, socketio_path=SIO_PATH, transports=["websocket"], wait_timeout=5)


# ── 鉴权验证 ──

def test_no_token_rejected() -> None:
    c = new_client()
    try:
        connect_with_token(c, None)
        record("无 token 连接被拒", False, "连接竟然成功了")
        c.disconnect()
    except Exception as e:
        record("无 token 连接被拒", True, f"已拒绝 ({type(e).__name__})")


def test_invalid_token_rejected() -> None:
    c = new_client()
    try:
        connect_with_token(c, "this.is.not.a.valid.jwt")
        record("无效 token 连接被拒", False, "连接竟然成功了")
        c.disconnect()
    except Exception as e:
        record("无效 token 连接被拒", True, f"已拒绝 ({type(e).__name__})")


# ── 完整协作流程 ──

def test_full_collab_flow(token_a: str, token_b: str, token_c: str) -> None:
    """覆盖验收点 3-12（除死代码外）"""
    # 事件收集容器（线程安全靠 GIL + list append 原子）
    a_user_joined: list[dict] = []
    a_user_left: list[dict] = []
    a_node_update_self: list[dict] = []  # A 自己 emit，期望不收到（skip_sid 验证）
    a_edge_update_self: list[dict] = []
    a_cursor_move_self: list[dict] = []
    b_node_update: list[dict] = []
    b_edge_update: list[dict] = []
    b_cursor_move: list[dict] = []

    # 用于同步等待异步事件到达
    ev_user_joined = threading.Event()
    ev_user_left = threading.Event()
    ev_node_update = threading.Event()
    ev_edge_update = threading.Event()
    ev_cursor_move = threading.Event()

    # 客户端 A
    client_a = new_client()

    @client_a.on("user_joined")
    def on_user_joined_a(data):
        a_user_joined.append(data)
        ev_user_joined.set()

    @client_a.on("user_left")
    def on_user_left_a(data):
        a_user_left.append(data)
        ev_user_left.set()

    @client_a.on("node_update")
    def on_node_update_a(data):
        # A 监听自己 emit 的事件，用于验证 skip_sid
        a_node_update_self.append(data)

    @client_a.on("edge_update")
    def on_edge_update_a(data):
        a_edge_update_self.append(data)

    @client_a.on("cursor_move")
    def on_cursor_move_a(data):
        a_cursor_move_self.append(data)

    # 客户端 B
    client_b = new_client()

    @client_b.on("node_update")
    def on_node_update_b(data):
        b_node_update.append(data)
        ev_node_update.set()

    @client_b.on("edge_update")
    def on_edge_update_b(data):
        b_edge_update.append(data)
        ev_edge_update.set()

    @client_b.on("cursor_move")
    def on_cursor_move_b(data):
        b_cursor_move.append(data)
        ev_cursor_move.set()

    # ── 验收点 3：有效 token 连接成功 ──
    try:
        connect_with_token(client_a, token_a)
        record("有效 token 连接成功 (A)", True)
    except Exception as e:
        record("有效 token 连接成功 (A)", False, f"连接失败: {e}")
        return

    # ── 验收点 4：A join 返回 1 人列表 ──
    ack_a = client_a.call("join_project", {"project_id": TEST_PROJECT}, timeout=5)
    if not isinstance(ack_a, dict) or "users" not in ack_a:
        record("A join_project 返回用户列表（1 人）", False, f"ack={ack_a}")
        client_a.disconnect()
        return
    users_a = ack_a["users"]
    record(
        "A join_project 返回用户列表（1 人）",
        len(users_a) == 1,
        f"users={users_a}",
    )

    # B 连接
    try:
        connect_with_token(client_b, token_b)
        record("有效 token 连接成功 (B)", True)
    except Exception as e:
        record("有效 token 连接成功 (B)", False, f"连接失败: {e}")
        client_a.disconnect()
        return

    # ── 验收点 5：B join 返回 2 人列表 ──
    # ── 验收点 6：A 收到 user_joined ──
    ack_b = client_b.call("join_project", {"project_id": TEST_PROJECT}, timeout=5)
    # 等待 A 收到 user_joined（websocket 模式通常 < 200ms，留 2s 余量）
    ev_user_joined.wait(timeout=2.0)

    if isinstance(ack_b, dict) and "users" in ack_b:
        users_b = ack_b["users"]
        record(
            "B join_project 返回用户列表（2 人）",
            len(users_b) == 2,
            f"users={users_b}",
        )
    else:
        record("B join_project 返回用户列表（2 人）", False, f"ack={ack_b}")

    record(
        "A 收到 user_joined 事件（B 加入）",
        len(a_user_joined) == 1,
        f"received={a_user_joined}",
    )

    # ── 验收点 7：A emit node_update，B 收到 ──
    node_payload = {
        "project_id": TEST_PROJECT,
        "node_id": "node-test-1",
        "action": "add",
        "node": {"id": "node-test-1", "type": "text", "data": {"label": "hello"}},
    }
    client_a.emit("node_update", node_payload)
    ev_node_update.wait(timeout=2.0)

    node_ok = (
        len(b_node_update) == 1
        and b_node_update[0].get("node_id") == "node-test-1"
        and b_node_update[0].get("action") == "add"
    )
    record(
        "A emit node_update，B 收到 node_update 事件",
        node_ok,
        f"received={b_node_update}",
    )

    # ── 验收点 8：A emit edge_update，B 收到 ──
    edge_payload = {
        "project_id": TEST_PROJECT,
        "edge_id": "edge-test-1",
        "action": "add",
        "edge": {"id": "edge-test-1", "source": "n1", "target": "n2"},
    }
    client_a.emit("edge_update", edge_payload)
    ev_edge_update.wait(timeout=2.0)

    edge_ok = (
        len(b_edge_update) == 1
        and b_edge_update[0].get("edge_id") == "edge-test-1"
        and b_edge_update[0].get("action") == "add"
    )
    record(
        "A emit edge_update，B 收到 edge_update 事件",
        edge_ok,
        f"received={b_edge_update}",
    )

    # ── 验收点 9：A emit cursor_move，B 收到（含 sid） ──
    cursor_payload = {"project_id": TEST_PROJECT, "x": 123.45, "y": 67.89}
    client_a.emit("cursor_move", cursor_payload)
    ev_cursor_move.wait(timeout=2.0)

    cursor_ok = (
        len(b_cursor_move) == 1
        and b_cursor_move[0].get("x") == 123.45
        and b_cursor_move[0].get("y") == 67.89
        and isinstance(b_cursor_move[0].get("sid"), str)
        and len(b_cursor_move[0].get("sid", "")) > 0
    )
    record(
        "A emit cursor_move，B 收到 cursor_move 事件（含 sid）",
        cursor_ok,
        f"received={b_cursor_move}",
    )

    # ── 验收点 10：A 不收到自己 emit 的事件（skip_sid 验证） ──
    # 给事件一点时间到达（若 skip_sid 失效，A 会立即收到）
    time.sleep(0.5)
    skip_sid_ok = (
        len(a_node_update_self) == 0
        and len(a_edge_update_self) == 0
        and len(a_cursor_move_self) == 0
    )
    record(
        "A 不收到自己 emit 的事件（skip_sid）",
        skip_sid_ok,
        f"node={a_node_update_self} edge={a_edge_update_self} cursor={a_cursor_move_self}",
    )

    # ── 验收点 11：B leave_project，A 收到 user_left ──
    client_b.emit("leave_project", {"project_id": TEST_PROJECT})
    ev_user_left.wait(timeout=2.0)

    record(
        "B leave_project，A 收到 user_left 事件",
        len(a_user_left) == 1,
        f"received={a_user_left}",
    )

    # B 主动断开（leave 后再 disconnect，确保不重复触发 user_left）
    client_b.disconnect()
    time.sleep(0.5)  # 给 disconnect 处理留时间

    # ── 验收点 12：B disconnect 后从 _room_members 移除 ──
    # 新 C join 同房间，列表应只含 A 和 C（2 人），不含 B
    client_c = new_client()
    connect_with_token(client_c, token_c)
    ack_c = client_c.call("join_project", {"project_id": TEST_PROJECT}, timeout=5)

    if isinstance(ack_c, dict) and "users" in ack_c:
        users_c = ack_c["users"]
        # B 已离开且 disconnect，列表应含 A 和 C 共 2 人
        record(
            "B disconnect 后从 _room_members 移除",
            len(users_c) == 2,
            f"users={users_c}",
        )
    else:
        record("B disconnect 后从 _room_members 移除", False, f"ack={ack_c}")

    client_c.disconnect()
    client_a.disconnect()


def test_dead_code_removed() -> None:
    """验收点：死代码 setup_collaboration 已删除（沿用 task1 验证）"""
    import importlib
    mod = importlib.import_module("app.ws.collaboration")
    has_func = hasattr(mod, "setup_collaboration")
    record("死代码 setup_collaboration 已删除", not has_func, f"hasattr={has_func}")


def main() -> int:
    print("=" * 60)
    print("Task 6 端到端验证脚本启动")
    print(f"BASE_URL={BASE_URL} PROJECT={TEST_PROJECT}")
    print("=" * 60)

    # 健康检查
    try:
        with httpx.Client(base_url=BASE_URL, timeout=5) as c:
            r = c.get("/health")
            if r.status_code != 200:
                print(f"后端不可用: {r.status_code}")
                return 2
    except Exception as e:
        print(f"后端不可用: {e}")
        return 2

    # 获取三个用户的 token（A、B 主流程，C 验证移除）
    token_a = get_token("ws_test_a", "testpass123")
    token_b = get_token("ws_test_b", "testpass123")
    token_c = get_token("ws_test_c", "testpass123")

    test_no_token_rejected()
    test_invalid_token_rejected()
    test_full_collab_flow(token_a, token_b, token_c)
    test_dead_code_removed()

    print("=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"结果汇总: {passed}/{total} 通过")
    for name, ok, detail in results:
        flag = "PASS" if ok else "FAIL"
        print(f"  [{flag}] {name}" + (f" — {detail}" if detail else ""))
    print("=" * 60)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
