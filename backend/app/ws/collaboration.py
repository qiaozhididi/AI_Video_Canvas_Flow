"""Socket.IO 协作处理"""

import socketio

# 创建独立的 Socket.IO ASGI 应用
# 实际挂载时在 main.py 中通过 mount 集成
sio_app = socketio.ASGIApp(socketio.AsyncServer(async_mode="asgi"))


async def setup_collaboration(app):
    """将 Socket.IO 协作服务挂载到 FastAPI 应用"""
    from app.api.collaboration import sio

    sio_asgi = socketio.ASGIApp(sio)
    app.mount("/ws", sio_asgi)
