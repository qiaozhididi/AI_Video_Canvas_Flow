"""工作流路由：节点/边操作"""

import logging
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DBSession
from app.models.project import Project
from app.models.workflow import WorkflowNode, WorkflowEdge
from app.schemas.workflow import (
    EdgeCreate,
    EdgeResponse,
    NodeCreate,
    NodeResponse,
    WorkflowSaveRequest,
    WorkflowSaveResponse,
)

logger = logging.getLogger("app.api.workflows")

router = APIRouter()


def _to_uuid(value: str, field: str = "项目 ID") -> uuid.UUID:
    """将字符串转为 UUID，失败则抛 400"""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的{field}格式")


async def _verify_project_owner(project_id: str, user_id: str, db: AsyncSession) -> Project:
    """验证项目存在且属于当前用户"""
    pid = _to_uuid(project_id)
    result = await db.execute(select(Project).where(Project.id == pid))
    project = result.scalar_one_or_none()
    if not project or str(project.owner_id) != user_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


# ── 节点操作 ──


@router.get("/{workflow_id}/nodes", response_model=list[NodeResponse], summary="获取工作流节点")
async def list_nodes(workflow_id: str, user: CurrentUser, db: DBSession):
    """获取指定工作流的所有节点"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)
    result = await db.execute(
        select(WorkflowNode).where(WorkflowNode.project_id == pid)
    )
    nodes = result.scalars().all()
    return [
        NodeResponse(
            id=n.id,
            project_id=str(n.project_id),
            node_type=n.node_type,
            label=n.label,
            position_x=n.position_x,
            position_y=n.position_y,
            config=n.config,
            created_at=n.created_at,
            updated_at=n.updated_at,
        )
        for n in nodes
    ]


@router.post("/{workflow_id}/nodes", response_model=NodeResponse, summary="创建节点")
async def create_node(workflow_id: str, body: NodeCreate, user: CurrentUser, db: DBSession):
    """在工作流中创建新节点"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)
    node = WorkflowNode(
        id=body.id,
        project_id=pid,
        node_type=body.node_type,
        label=body.label,
        position_x=body.position_x,
        position_y=body.position_y,
        config=body.config,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    logger.info(f"[Workflow:CreateNode] id={node.id} project={workflow_id}")
    return NodeResponse(
        id=node.id,
        project_id=str(node.project_id),
        node_type=node.node_type,
        label=node.label,
        position_x=node.position_x,
        position_y=node.position_y,
        config=node.config,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


@router.delete("/{workflow_id}/nodes/{node_id}", status_code=204, summary="删除节点")
async def delete_node(workflow_id: str, node_id: str, user: CurrentUser, db: DBSession):
    """删除指定节点（同时删除关联的边）"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)
    result = await db.execute(
        select(WorkflowNode).where(
            WorkflowNode.id == node_id,
            WorkflowNode.project_id == pid,
        )
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 先删除关联的边
    edge_result = await db.execute(
        select(WorkflowEdge).where(
            (WorkflowEdge.source_node_id == node_id) | (WorkflowEdge.target_node_id == node_id)
        )
    )
    for edge in edge_result.scalars().all():
        await db.delete(edge)

    await db.delete(node)
    await db.commit()
    logger.info(f"[Workflow:DeleteNode] id={node_id} project={workflow_id}")


# ── 边操作 ──


@router.get("/{workflow_id}/edges", response_model=list[EdgeResponse], summary="获取工作流边")
async def list_edges(workflow_id: str, user: CurrentUser, db: DBSession):
    """获取指定工作流的所有边"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)
    result = await db.execute(
        select(WorkflowEdge).where(WorkflowEdge.project_id == pid)
    )
    edges = result.scalars().all()
    return [
        EdgeResponse(
            id=e.id,
            project_id=str(e.project_id),
            source_node_id=e.source_node_id,
            target_node_id=e.target_node_id,
            source_port=e.source_port,
            target_port=e.target_port,
            created_at=e.created_at,
            updated_at=e.updated_at,
        )
        for e in edges
    ]


@router.post("/{workflow_id}/edges", response_model=EdgeResponse, summary="创建边")
async def create_edge(workflow_id: str, body: EdgeCreate, user: CurrentUser, db: DBSession):
    """在工作流中创建新边（连接两个节点）"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)
    edge = WorkflowEdge(
        id=body.id,
        project_id=pid,
        source_node_id=body.source_node_id,
        target_node_id=body.target_node_id,
        source_port=body.source_port,
        target_port=body.target_port,
    )
    db.add(edge)
    await db.commit()
    await db.refresh(edge)
    logger.info(f"[Workflow:CreateEdge] id={edge.id} project={workflow_id}")
    return EdgeResponse(
        id=edge.id,
        project_id=str(edge.project_id),
        source_node_id=edge.source_node_id,
        target_node_id=edge.target_node_id,
        source_port=edge.source_port,
        target_port=edge.target_port,
        created_at=edge.created_at,
        updated_at=edge.updated_at,
    )


@router.delete("/{workflow_id}/edges/{edge_id}", status_code=204, summary="删除边")
async def delete_edge(workflow_id: str, edge_id: str, user: CurrentUser, db: DBSession):
    """删除指定边"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)
    result = await db.execute(
        select(WorkflowEdge).where(
            WorkflowEdge.id == edge_id,
            WorkflowEdge.project_id == pid,
        )
    )
    edge = result.scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="边不存在")

    await db.delete(edge)
    await db.commit()
    logger.info(f"[Workflow:DeleteEdge] id={edge_id} project={workflow_id}")


# ── 批量操作（保存/加载） ──


@router.put("/{workflow_id}/save", response_model=WorkflowSaveResponse, summary="批量保存工作流")
async def save_workflow(workflow_id: str, body: WorkflowSaveRequest, user: CurrentUser, db: DBSession):
    """批量保存工作流：替换项目的全部节点和边"""
    await _verify_project_owner(workflow_id, user, db)
    pid = _to_uuid(workflow_id)

    # 删除旧数据：先删边（有外键引用节点），再删节点
    old_edges = await db.execute(
        select(WorkflowEdge).where(WorkflowEdge.project_id == pid)
    )
    for e in old_edges.scalars().all():
        await db.delete(e)

    old_nodes = await db.execute(
        select(WorkflowNode).where(WorkflowNode.project_id == pid)
    )
    for n in old_nodes.scalars().all():
        await db.delete(n)

    # 先插入节点
    for node_data in body.nodes:
        node = WorkflowNode(
            id=node_data.id,
            project_id=pid,
            node_type=node_data.node_type,
            label=node_data.label,
            position_x=node_data.position_x,
            position_y=node_data.position_y,
            config=node_data.config,
        )
        db.add(node)

    # flush 确保节点先写入，避免外键约束冲突
    await db.flush()

    # 再插入边
    for edge_data in body.edges:
        edge = WorkflowEdge(
            id=edge_data.id,
            project_id=pid,
            source_node_id=edge_data.source_node_id,
            target_node_id=edge_data.target_node_id,
            source_port=edge_data.source_port,
            target_port=edge_data.target_port,
        )
        db.add(edge)

    await db.commit()
    logger.info(
        f"[Workflow:Save] project={workflow_id} "
        f"nodes={len(body.nodes)} edges={len(body.edges)}"
    )
    return WorkflowSaveResponse(
        nodes_count=len(body.nodes),
        edges_count=len(body.edges),
    )
