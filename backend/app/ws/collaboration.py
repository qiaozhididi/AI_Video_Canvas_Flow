"""Socket.IO 协作处理 — 含详细日志"""

import logging
import time
import uuid
from urllib.parse import parse_qs

import socketio
from jose import JWTError, jwt
from sqlalchemy import select

from app.config import settings
from app.database import async_session_factory
from app.models.user import User

logger = logging.getLogger("app.ws.collaboration")

# 创建 Socket.IO 服务端实例
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.CORS_ORIGINS,
    logger=False,
    engineio_logger=False,
)

# 全局房间成员清单：key=room_id, value=[{sid, user_id, username}, ...]
_room_members: dict[str, list[dict]] = {}


async def _fetch_username(user_id: str) -> str:
    """根据 user_id 查询 DB 获取真实 username，失败时降级为 'unknown'"""
    try:
        async with async_session_factory() as db:
            stmt = select(User).where(User.id == uuid.UUID(user_id))
            result = await db.execute(stmt)
            user = result.scalar_one_or_none()
            return user.username if user else "unknown"
    except Exception as e:
        logger.warning(f"[WS:Auth] 查询 username 失败 user_id={user_id} err={e}")
        return "unknown"


async def _get_session_info(sid: str) -> dict:
    """从 session 取 user_id 和 username"""
    session = await sio.get_session(sid)
    return session or {}


def _remove_member_from_room(sid: str, room: str) -> dict | None:
    """从指定房间的成员清单移除 sid，返回被移除的成员 dict（若存在）"""
    members = _room_members.get(room)
    if not members:
        return None
    for i, m in enumerate(members):
        if m["sid"] == sid:
            return members.pop(i)
    return None


# ── 连接管理 ──

@sio.event
async def connect(sid, environ):
    """客户端连接事件 — 验证 JWT token"""
    client_ip = environ.get("REMOTE_ADDR", "unknown")

    # 从 query string 解析 token（不记录 token 明文）
    qs = environ.get("QUERY_STRING", "")
    token = parse_qs(qs).get("token", [None])[0]

    if not token:
        logger.warning(f"[WS:Connect] sid={sid} ip={client_ip} 拒绝：缺少 token")
        return False

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str | None = payload.get("sub")
        if not user_id:
            logger.warning(f"[WS:Connect] sid={sid} ip={client_ip} 拒绝：token 缺少 sub")
            return False
    except JWTError as e:
        logger.warning(f"[WS:Connect] sid={sid} ip={client_ip} 拒绝：token 无效 ({e})")
        return False

    # 查询 DB 获取真实 username（JWT 不含 username）
    username = await _fetch_username(user_id)

    await sio.save_session(sid, {"user_id": user_id, "username": username})

    user_agent = environ.get("HTTP_USER_AGENT", "unknown")[:80]
    logger.info(
        f"[WS:Connect] sid={sid} ip={client_ip} user={user_id} name={username} ua={user_agent}"
    )


@sio.event
async def disconnect(sid):
    """客户端断开事件 — 清理所有房间成员清单"""
    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")
    rooms = sio.rooms(sid)
    logger.info(f"[WS:Disconnect] sid={sid} user={user_id} rooms={rooms}")

    # 遍历所有房间成员清单移除该 sid（不依赖 sio.rooms，disconnect 时 rooms 可能已清空）
    for room in list(_room_members.keys()):
        removed = _remove_member_from_room(sid, room)
        if removed:
            try:
                await sio.leave_room(sid, room)
            except Exception:
                pass
            logger.debug(f"[WS:LeaveRoom] sid={sid} room={room} (auto on disconnect)")
            await sio.emit(
                "user_left",
                {"user_id": removed["user_id"], "username": removed["username"], "sid": sid},
                room=room,
            )


# ── 房间管理 ──

@sio.on("join_project")
async def join_project(sid, data):
    """加入项目协作房间"""
    t0 = time.time()
    project_id = data.get("project_id")

    if not project_id:
        logger.warning(f"[WS:JoinProject] sid={sid} 缺少 project_id")
        return {"error": "project_id is required"}

    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")
    username = session.get("username", "unknown")

    room = f"project:{project_id}"
    await sio.enter_room(sid, room)

    # 添加到房间成员清单
    member = {"sid": sid, "user_id": user_id, "username": username}
    _room_members.setdefault(room, []).append(member)

    elapsed = (time.time() - t0) * 1000
    logger.info(
        f"[WS:JoinProject] sid={sid} user={user_id} name={username} "
        f"project={project_id} room={room} ({elapsed:.1f}ms)"
    )

    # 通知房间内其他成员
    await sio.emit(
        "user_joined",
        {"user_id": user_id, "username": username, "sid": sid},
        room=room,
        skip_sid=sid,
    )

    # 返回当前房间在线用户快照（ack 数据）
    return {"users": _room_members.get(room, [])}


@sio.on("leave_project")
async def leave_project(sid, data):
    """离开项目协作房间"""
    project_id = data.get("project_id")

    if not project_id:
        return

    room = f"project:{project_id}"
    removed = _remove_member_from_room(sid, room)
    if not removed:
        return
    try:
        await sio.leave_room(sid, room)
    except Exception:
        pass
    logger.info(
        f"[WS:LeaveProject] sid={sid} user={removed['user_id']} project={project_id}"
    )

    # 通知房间内其他成员
    await sio.emit(
        "user_left",
        {"user_id": removed["user_id"], "username": removed["username"], "sid": sid},
        room=room,
    )


# ── 操作广播 ──

@sio.on("node_update")
async def node_update(sid, data):
    """节点更新事件，广播给同房间的其他协作者"""
    t0 = time.time()
    project_id = data.get("project_id")
    node_id = data.get("node_id", "?")
    action = data.get("action", "update")

    if not project_id:
        logger.warning(f"[WS:NodeUpdate] sid={sid} 缺少 project_id")
        return

    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")

    room = f"project:{project_id}"
    await sio.emit("node_update", data, room=room, skip_sid=sid)

    elapsed = (time.time() - t0) * 1000
    logger.debug(
        f"[WS:NodeUpdate] sid={sid} user={user_id} project={project_id} node={node_id} "
        f"action={action} broadcast→{room} ({elapsed:.1f}ms)"
    )


@sio.on("edge_update")
async def edge_update(sid, data):
    """边更新事件，广播给同房间的其他协作者"""
    t0 = time.time()
    project_id = data.get("project_id")
    edge_id = data.get("edge_id", "?")
    action = data.get("action", "update")

    if not project_id:
        logger.warning(f"[WS:EdgeUpdate] sid={sid} 缺少 project_id")
        return

    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")

    room = f"project:{project_id}"
    await sio.emit("edge_update", data, room=room, skip_sid=sid)

    elapsed = (time.time() - t0) * 1000
    logger.debug(
        f"[WS:EdgeUpdate] sid={sid} user={user_id} project={project_id} edge={edge_id} "
        f"action={action} broadcast→{room} ({elapsed:.1f}ms)"
    )


@sio.on("cursor_move")
async def cursor_move(sid, data):
    """远端光标移动事件"""
    project_id = data.get("project_id")
    if not project_id:
        return

    session = await _get_session_info(sid)
    user_id = session.get("user_id", "unknown")
    username = session.get("username", "unknown")

    room = f"project:{project_id}"
    # 用完整 sid（与 join_project ack 一致），并附 user_id/username 使 cursor 自包含，
    # 前端不再依赖 onlineUsers 按 sid 关联（避免 sid 不一致导致光标"匿名"）
    data["sid"] = sid
    data["user_id"] = user_id
    data["username"] = username
    await sio.emit("cursor_move", data, room=room, skip_sid=sid)
    logger.debug(f"[WS:CursorMove] sid={sid} user={user_id} project={project_id}")


@sio.on("ping")
async def ping(sid, data):
    """心跳/延迟检测"""
    import time as _time
    client_time = data.get("client_time", 0)
    server_time = _time.time() * 1000
    latency = server_time - client_time

    logger.debug(f"[WS:Ping] sid={sid} latency≈{latency:.0f}ms")
    await sio.emit("pong", {"client_time": client_time, "server_time": server_time}, room=sid)
