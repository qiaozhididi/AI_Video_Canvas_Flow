"""Task 1 验证脚本：后端 Socket.IO connect JWT 鉴权 + 房间成员清单 + 死代码清理

覆盖验收点：
1. 无 token 连接被拒
2. 无效 token 连接被拒
3. 有效 token 连接成功
4. join_project 返回在线用户列表
5. 第二个用户 join 后，第一个用户收到 user_joined 事件
6. disconnect 后从 _room_members 移除
7. 死代码 setup_collaboration 已删除

运行方式：cd backend && .venv/bin/python verify_task1.py
前置条件：
- 后端 uvicorn 服务运行在 localhost:8000
- 已安装 websocket-client（pip install websocket-client），用于 websocket transport
  （polling 模式下 client.disconnect() 不触发服务端 disconnect 事件，无法验证清理逻辑）
"""

import sys
import time
import uuid

import httpx
import socketio

BASE_URL = "http://localhost:8000"
WS_URL = "http://localhost:8000"
SIO_PATH = "socket.io"
TEST_PROJECT = f"verify-task1-{uuid.uuid4().hex[:8]}"

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name}" + (f" — {detail}" if detail else ""))


def get_token(username: str, password: str) -> str:
    """注册（若已存在则忽略失败）+ 登录，返回 access_token"""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        # 尝试注册（已存在则忽略）
        c.post("/api/v1/auth/register", json={"username": username, "email": f"{username}@test.local", "password": password})
        # 登录
        r = c.post("/api/v1/auth/login", json={"username": username, "password": password})
        r.raise_for_status()
        return r.json()["access_token"]


def new_client() -> socketio.Client:
    """创建 socketio 客户端"""
    return socketio.Client(logger=False, engineio_logger=False, reconnection=False)


def connect_with_token(c: socketio.Client, token: str | None) -> None:
    """带 token 连接（token=None 则不带，URL 拼 query string）

    使用 websocket transport（与前端一致，且 polling 模式下 client.disconnect()
    不触发服务端 disconnect 事件，无法验证清理逻辑）。
    """
    url = f"{WS_URL}?token={token}" if token else WS_URL
    c.connect(url, socketio_path=SIO_PATH, transports=["websocket"], wait_timeout=5)


def test_no_token_rejected() -> None:
    """验收点 1：无 token 连接被拒"""
    c = new_client()
    try:
        connect_with_token(c, None)
        record("无 token 连接被拒", False, "连接竟然成功了")
        c.disconnect()
    except Exception as e:
        record("无 token 连接被拒", True, f"已拒绝 ({type(e).__name__})")


def test_invalid_token_rejected() -> None:
    """验收点 2：无效 token 连接被拒"""
    c = new_client()
    try:
        connect_with_token(c, "this.is.not.a.valid.jwt")
        record("无效 token 连接被拒", False, "连接竟然成功了")
        c.disconnect()
    except Exception as e:
        record("无效 token 连接被拒", True, f"已拒绝 ({type(e).__name__})")


def test_valid_token_and_join_and_user_events(token_a: str, token_b: str) -> None:
    """验收点 3-6：有效 token 连接 + join 返回列表 + user_joined + disconnect 移除"""
    received_joined: list[dict] = []
    received_left: list[dict] = []

    # 客户端 A
    client_a = new_client()

    @client_a.on("user_joined")
    def on_user_joined_a(data):
        received_joined.append(data)

    @client_a.on("user_left")
    def on_user_left_a(data):
        received_left.append(data)

    try:
        connect_with_token(client_a, token_a)
        record("有效 token 连接成功 (A)", True)
    except Exception as e:
        record("有效 token 连接成功 (A)", False, f"连接失败: {e}")
        return

    # A join
    ack_a = client_a.call("join_project", {"project_id": TEST_PROJECT}, timeout=5)
    if not isinstance(ack_a, dict) or "users" not in ack_a:
        record("join_project 返回用户列表 (A)", False, f"ack={ack_a}")
        client_a.disconnect()
        return
    users_a = ack_a["users"]
    a_in_list = any(u.get("user_id") for u in users_a) and len(users_a) == 1
    record("join_project 返回用户列表 (A)", a_in_list, f"users={users_a}")

    # 检查返回结构含 sid/user_id/username
    struct_ok = all(set(u.keys()) >= {"sid", "user_id", "username"} for u in users_a)
    record("返回用户结构含 sid/user_id/username", struct_ok, f"keys={list(users_a[0].keys()) if users_a else []}")

    # 客户端 B
    client_b = new_client()
    try:
        connect_with_token(client_b, token_b)
        record("有效 token 连接成功 (B)", True)
    except Exception as e:
        record("有效 token 连接成功 (B)", False, f"连接失败: {e}")
        client_a.disconnect()
        return

    # B join，A 应收到 user_joined
    ack_b = client_b.call("join_project", {"project_id": TEST_PROJECT}, timeout=5)
    time.sleep(1.0)  # 等待 A 收到 user_joined 事件（polling 模式需留足时间）

    if not isinstance(ack_b, dict) or "users" not in ack_b:
        record("join_project 返回用户列表 (B)", False, f"ack={ack_b}")
    else:
        users_b = ack_b["users"]
        record("join_project 返回用户列表 (B)", len(users_b) == 2, f"users={users_b}")

    record("A 收到 user_joined 事件", len(received_joined) == 1, f"received={received_joined}")

    # B disconnect，A 应收到 user_left，且 B 从成员清单移除
    client_b.disconnect()
    time.sleep(1.5)  # 等待服务端 disconnect 处理 + 事件传播

    record("A 收到 user_left 事件", len(received_left) == 1, f"received={received_left}")

    # 验证 B 已从 _room_members 移除：新客户端 C join 同房间，列表应只有 A 和 C
    token_c = get_token("ws_test_c", "testpass123")
    client_c = new_client()
    connect_with_token(client_c, token_c)
    ack_c = client_c.call("join_project", {"project_id": TEST_PROJECT}, timeout=5)
    client_c.disconnect()
    time.sleep(0.5)

    if isinstance(ack_c, dict) and "users" in ack_c:
        users_c = ack_c["users"]
        # B 已离开，列表应含 A 和 C（2 个），不含 B
        record("disconnect 后 B 已从成员清单移除", len(users_c) == 2, f"users={users_c}")
    else:
        record("disconnect 后 B 已从成员清单移除", False, f"ack={ack_c}")

    client_a.disconnect()


def test_dead_code_removed() -> None:
    """验收点 7：死代码 setup_collaboration 已删除"""
    import importlib
    mod = importlib.import_module("app.ws.collaboration")
    has_func = hasattr(mod, "setup_collaboration")
    record("死代码 setup_collaboration 已删除", not has_func, f"hasattr={has_func}")


def main() -> int:
    print("=" * 60)
    print("Task 1 验证脚本启动")
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

    # 获取两个用户的 token
    token_a = get_token("ws_test_a", "testpass123")
    token_b = get_token("ws_test_b", "testpass123")

    test_no_token_rejected()
    test_invalid_token_rejected()
    test_valid_token_and_join_and_user_events(token_a, token_b)
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
