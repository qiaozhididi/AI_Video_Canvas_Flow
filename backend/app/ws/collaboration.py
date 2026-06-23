"""Socket.IO 协作处理 — 含详细日志"""

import logging
import time

import socketio

from app.config import settings

logger = logging.getLogger("app.ws.collaboration")

# 创建 Socket.IO 服务端实例
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.CORS_ORIGINS,
    logger=False,
    engineio_logger=False,
)


async def setup_collaboration(app):
    """将 Socket.IO 协作服务挂载到 FastAPI 应用"""
    sio_asgi = socketio.ASGIApp(sio)
    app.mount("/ws", sio_asgi)
    logger.info("Socket.IO ASGI 应用已挂载到 /ws")


# ── 连接管理 ──

@sio.event
async def connect(sid, environ):
    """客户端连接事件"""
    client_ip = environ.get("REMOTE_ADDR", "unknown")
    user_agent = environ.get("HTTP_USER_AGENT", "unknown")[:80]
    logger.info(f"[WS:Connect] sid={sid} ip={client_ip} ua={user_agent}")


@sio.event
async def disconnect(sid):
    """客户端断开事件"""
    rooms = sio.rooms(sid)
    logger.info(f"[WS:Disconnect] sid={sid} rooms={rooms}")
    # 自动离开所有项目房间
    for room in rooms:
        if room.startswith("project:"):
            await sio.leave_room(sid, room)
            logger.debug(f"[WS:LeaveRoom] sid={sid} room={room} (auto on disconnect)")


# ── 房间管理 ──

@sio.on("join_project")
async def join_project(sid, data):
    """加入项目协作房间"""
    t0 = time.time()
    project_id = data.get("project_id")
    user_id = data.get("user_id", "unknown")

    if not project_id:
        logger.warning(f"[WS:JoinProject] sid={sid} 缺少 project_id")
        return {"error": "project_id is required"}

    room = f"project:{project_id}"
    sio.enter_room(sid, room)

    elapsed = (time.time() - t0) * 1000
    logger.info(
        f"[WS:JoinProject] sid={sid} user={user_id} project={project_id} "
        f"room={room} ({elapsed:.1f}ms)"
    )

    # 通知房间内其他成员
    await sio.emit("user_joined", {"user_id": user_id, "sid": sid[:8]}, room=room, skip_sid=sid)


@sio.on("leave_project")
async def leave_project(sid, data):
    """离开项目协作房间"""
    project_id = data.get("project_id")
    user_id = data.get("user_id", "unknown")

    if not project_id:
        return

    room = f"project:{project_id}"
    await sio.leave_room(sid, room)
    logger.info(f"[WS:LeaveProject] sid={sid} user={user_id} project={project_id}")

    # 通知房间内其他成员
    await sio.emit("user_left", {"user_id": user_id, "sid": sid[:8]}, room=room)


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

    room = f"project:{project_id}"
    await sio.emit("node_update", data, room=room, skip_sid=sid)

    elapsed = (time.time() - t0) * 1000
    logger.debug(
        f"[WS:NodeUpdate] sid={sid} project={project_id} node={node_id} "
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

    room = f"project:{project_id}"
    await sio.emit("edge_update", data, room=room, skip_sid=sid)

    elapsed = (time.time() - t0) * 1000
    logger.debug(
        f"[WS:EdgeUpdate] sid={sid} project={project_id} edge={edge_id} "
        f"action={action} broadcast→{room} ({elapsed:.1f}ms)"
    )


@sio.on("cursor_move")
async def cursor_move(sid, data):
    """远端光标移动事件"""
    project_id = data.get("project_id")
    if not project_id:
        return

    room = f"project:{project_id}"
    data["sid"] = sid[:8]
    await sio.emit("cursor_move", data, room=room, skip_sid=sid)


@sio.on("ping")
async def ping(sid, data):
    """心跳/延迟检测"""
    import time as _time
    client_time = data.get("client_time", 0)
    server_time = _time.time() * 1000
    latency = server_time - client_time

    logger.debug(f"[WS:Ping] sid={sid} latency≈{latency:.0f}ms")
    await sio.emit("pong", {"client_time": client_time, "server_time": server_time}, room=sid)
