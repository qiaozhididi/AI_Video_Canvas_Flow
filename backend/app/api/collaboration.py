"""协作 WebSocket 路由（Socket.IO）"""

import socketio

from app.config import settings

# 创建 Socket.IO 服务端实例
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.CORS_ORIGINS,
)

from fastapi import APIRouter

router = APIRouter()


@sio.event
async def connect(sid, environ):
    """客户端连接事件"""
    pass


@sio.event
async def disconnect(sid):
    """客户端断开事件"""
    pass


@sio.on("join_project")
async def join_project(sid, data):
    """加入项目协作房间"""
    project_id = data.get("project_id")
    if project_id:
        sio.enter_room(sid, f"project:{project_id}")


@sio.on("leave_project")
async def leave_project(sid, data):
    """离开项目协作房间"""
    project_id = data.get("project_id")
    if project_id:
        sio.leave_room(sid, f"project:{project_id}")


@sio.on("node_update")
async def node_update(sid, data):
    """节点更新事件，广播给同房间的其他协作者"""
    project_id = data.get("project_id")
    if project_id:
        await sio.emit("node_update", data, room=f"project:{project_id}", skip_sid=sid)


@sio.on("edge_update")
async def edge_update(sid, data):
    """边更新事件，广播给同房间的其他协作者"""
    project_id = data.get("project_id")
    if project_id:
        await sio.emit("edge_update", data, room=f"project:{project_id}", skip_sid=sid)
