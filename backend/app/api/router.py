"""汇总所有子路由，统一 /api/v1 前缀"""

from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.collaboration import router as collaboration_router
from app.api.media import router as media_router
from app.api.projects import router as projects_router
from app.api.render import router as render_router
from app.api.workflows import router as workflows_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth_router, prefix="/auth", tags=["认证"])
api_router.include_router(projects_router, prefix="/projects", tags=["项目"])
api_router.include_router(workflows_router, prefix="/workflows", tags=["工作流"])
api_router.include_router(media_router, prefix="/media", tags=["媒体资产"])
api_router.include_router(render_router, prefix="/render", tags=["渲染任务"])
api_router.include_router(collaboration_router, prefix="/collab", tags=["协作"])
