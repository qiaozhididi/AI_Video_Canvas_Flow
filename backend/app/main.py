"""FastAPI 应用入口，挂载路由、CORS、生命周期"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import settings

# 配置日志
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化资源，关闭时释放资源"""
    logger.info("AI Canvas Flow 后端服务启动中...")
    logger.info(f"   项目: {settings.PROJECT_NAME} v{settings.VERSION}")
    logger.info(f"   数据库: {settings.DATABASE_URL.split('@')[-1]}")
    logger.info(f"   Redis: {settings.REDIS_URL}")
    logger.info(f"   MinIO: {settings.MINIO_ENDPOINT}")
    logger.info(f"   CORS: {settings.CORS_ORIGINS}")

    # 自动创建数据库表（开发模式）
    from app.database import Base, engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("   数据库表已创建/验证")

    start_time = time.time()

    yield

    elapsed = time.time() - start_time
    logger.info(f"AI Canvas Flow 后端服务关闭，运行时长: {elapsed:.1f}s")


# 创建 FastAPI 应用
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
)

# CORS 中间件，允许前端开发服务器访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 请求日志中间件
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """记录每个请求的方法、路径和耗时"""
    start = time.time()
    response = await call_next(request)
    elapsed = (time.time() - start) * 1000
    logger.debug(f"{request.method} {request.url.path} -> {response.status_code} ({elapsed:.1f}ms)")
    return response


# 挂载 API 路由
app.include_router(api_router)


# 健康检查端点
@app.get("/health", tags=["健康检查"])
async def health_check():
    """健康检查端点"""
    return {"status": "ok", "version": settings.VERSION}


# 挂载 Socket.IO 协作服务
# 使用 other_asgi_app 将 FastAPI 和 Socket.IO 共存于同一端口
# Socket.IO 请求走 /socket.io/ 路径，其余走 FastAPI
import socketio as _socketio
from app.ws.collaboration import sio

app = _socketio.ASGIApp(sio, other_asgi_app=app)
logger.info("   Socket.IO 协作服务已挂载（/socket.io/）")
