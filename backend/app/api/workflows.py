"""工作流路由：节点/边操作"""

from uuid import UUID

from fastapi import APIRouter

from app.deps import CurrentUser, DBSession
from app.schemas.workflow import EdgeCreate, EdgeResponse, NodeCreate, NodeResponse

router = APIRouter()


# ── 节点操作 ──


@router.get("/{workflow_id}/nodes", response_model=list[NodeResponse], summary="获取工作流节点")
async def list_nodes(workflow_id: UUID, user: CurrentUser, db: DBSession):
    """获取指定工作流的所有节点"""
    # TODO: 查询节点
    return []


@router.post("/{workflow_id}/nodes", response_model=NodeResponse, summary="创建节点")
async def create_node(workflow_id: UUID, body: NodeCreate, user: CurrentUser, db: DBSession):
    """在工作流中创建新节点"""
    # TODO: 创建节点
    return None


@router.delete("/{workflow_id}/nodes/{node_id}", status_code=204, summary="删除节点")
async def delete_node(workflow_id: UUID, node_id: UUID, user: CurrentUser, db: DBSession):
    """删除指定节点"""
    # TODO: 删除节点


# ── 边操作 ──


@router.get("/{workflow_id}/edges", response_model=list[EdgeResponse], summary="获取工作流边")
async def list_edges(workflow_id: UUID, user: CurrentUser, db: DBSession):
    """获取指定工作流的所有边"""
    # TODO: 查询边
    return []


@router.post("/{workflow_id}/edges", response_model=EdgeResponse, summary="创建边")
async def create_edge(workflow_id: UUID, body: EdgeCreate, user: CurrentUser, db: DBSession):
    """在工作流中创建新边（连接两个节点）"""
    # TODO: 创建边
    return None


@router.delete("/{workflow_id}/edges/{edge_id}", status_code=204, summary="删除边")
async def delete_edge(workflow_id: UUID, edge_id: UUID, user: CurrentUser, db: DBSession):
    """删除指定边"""
    # TODO: 删除边
