"""渲染任务路由"""

from uuid import UUID

from fastapi import APIRouter

from app.deps import CurrentUser, DBSession
from app.schemas.render import RenderTaskCreate, RenderTaskResponse

router = APIRouter()


@router.post("/", response_model=RenderTaskResponse, summary="创建渲染任务")
async def create_render_task(body: RenderTaskCreate, user: CurrentUser, db: DBSession):
    """创建新的渲染任务，提交到 Celery 队列"""
    # TODO: 调用 render_service 创建任务
    return None


@router.get("/{task_id}", response_model=RenderTaskResponse, summary="获取渲染任务状态")
async def get_render_task(task_id: UUID, user: CurrentUser, db: DBSession):
    """获取指定渲染任务的状态和进度"""
    # TODO: 查询任务状态
    return None


@router.post("/{task_id}/cancel", response_model=RenderTaskResponse, summary="取消渲染任务")
async def cancel_render_task(task_id: UUID, user: CurrentUser, db: DBSession):
    """取消正在进行的渲染任务"""
    # TODO: 调用 render_service 取消任务
    return None
