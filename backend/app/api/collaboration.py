"""协作 WebSocket 路由（Socket.IO 事件由 app.ws.collaboration 统一管理）"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/status", summary="协作服务状态")
async def collab_status():
    """协作服务状态检查"""
    return {"status": "ok", "transport": "socket.io"}
