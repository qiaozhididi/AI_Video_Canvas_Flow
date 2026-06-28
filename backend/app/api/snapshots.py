"""快照 CRUD + 恢复路由"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, select

from app.deps import CurrentUser, DBSession
from app.models.project import Project
from app.models.project_snapshot import ProjectSnapshot
from app.models.workflow import WorkflowEdge, WorkflowNode
from app.schemas.snapshot import (
    SnapshotCreate,
    SnapshotRestoreResponse,
    SnapshotResponse,
)

logger = logging.getLogger("app.api.snapshots")

router = APIRouter()

AUTOSAVE_LIMIT = 5


def _to_uuid(value: str, field: str = "ID") -> uuid.UUID:
    """字符串转 UUID，失败抛 400"""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的{field}格式")


def _to_response(s: ProjectSnapshot) -> SnapshotResponse:
    """ORM 对象转响应"""
    return SnapshotResponse(
        id=s.id,
        project_id=s.project_id,
        owner_id=s.owner_id,
        source=s.source,
        label=s.label,
        snapshot_data=s.snapshot_data,
        created_at=s.created_at,
    )


async def _verify_project_owner(
    project_id: str, user_id: str, db
) -> Project:
    """验证项目存在且属于当前用户"""
    pid = _to_uuid(project_id, "项目 ID")
    result = await db.execute(select(Project).where(Project.id == pid))
    project = result.scalar_one_or_none()
    if not project or str(project.owner_id) != user_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


# ── 项目级端点 ──


@router.post(
    "/projects/{project_id}/snapshots",
    response_model=SnapshotResponse,
    summary="创建快照",
)
async def create_snapshot(
    project_id: str,
    body: SnapshotCreate,
    user: CurrentUser,
    db: DBSession,
):
    """创建快照（自动 source='auto' 时受 5 条上限约束）"""
    project = await _verify_project_owner(project_id, user, db)
    pid = project.id
    owner_id = uuid.UUID(user)

    # auto 快照上限：>=5 则删除最旧
    if body.source == "auto":
        existing = await db.execute(
            select(ProjectSnapshot)
            .where(
                ProjectSnapshot.project_id == pid,
                ProjectSnapshot.source == "auto",
            )
            .order_by(ProjectSnapshot.created_at.desc())
        )
        auto_snapshots = existing.scalars().all()
        if len(auto_snapshots) >= AUTOSAVE_LIMIT:
            # 删除最旧的（列表按 created_at DESC 排序，最后一条最旧）
            oldest = auto_snapshots[-1]
            await db.delete(oldest)
            logger.info(
                f"[Snapshot:Create] 清理最旧 auto 快照 id={oldest.id}"
            )

    snapshot = ProjectSnapshot(
        project_id=pid,
        owner_id=owner_id,
        snapshot_data=body.snapshot_data,
        source=body.source,
        label=body.label,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)
    logger.info(
        f"[Snapshot:Create] id={snapshot.id} project={project_id} "
        f"source={body.source} label={body.label}"
    )
    return _to_response(snapshot)


@router.get(
    "/projects/{project_id}/snapshots",
    response_model=list[SnapshotResponse],
    summary="获取快照列表",
)
async def list_snapshots(
    project_id: str,
    user: CurrentUser,
    db: DBSession,
    source: str | None = Query(None, description="按 source 筛选: auto / manual"),
):
    """获取项目快照列表（按 created_at DESC 排序）"""
    await _verify_project_owner(project_id, user, db)
    pid = _to_uuid(project_id, "项目 ID")
    stmt = select(ProjectSnapshot).where(ProjectSnapshot.project_id == pid)
    if source:
        stmt = stmt.where(ProjectSnapshot.source == source)
    stmt = stmt.order_by(ProjectSnapshot.created_at.desc())
    result = await db.execute(stmt)
    return [_to_response(s) for s in result.scalars().all()]


@router.get(
    "/projects/{project_id}/snapshots/latest",
    response_model=SnapshotResponse,
    summary="获取最新快照",
)
async def get_latest_snapshot(
    project_id: str,
    user: CurrentUser,
    db: DBSession,
):
    """获取项目最新一条快照（不限 source），无则 404"""
    await _verify_project_owner(project_id, user, db)
    pid = _to_uuid(project_id, "项目 ID")
    result = await db.execute(
        select(ProjectSnapshot)
        .where(ProjectSnapshot.project_id == pid)
        .order_by(ProjectSnapshot.created_at.desc())
        .limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="无快照")
    return _to_response(snapshot)


# ── 快照级端点 ──


async def _get_owned_snapshot(
    snapshot_id: str, user_id: str, db
) -> ProjectSnapshot:
    """获取快照并校验所属用户"""
    sid = _to_uuid(snapshot_id, "快照 ID")
    result = await db.execute(
        select(ProjectSnapshot).where(ProjectSnapshot.id == sid)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot or str(snapshot.owner_id) != user_id:
        raise HTTPException(status_code=404, detail="快照不存在")
    return snapshot


@router.get(
    "/snapshots/{snapshot_id}",
    response_model=SnapshotResponse,
    summary="获取快照详情",
)
async def get_snapshot(snapshot_id: str, user: CurrentUser, db: DBSession):
    """获取指定快照详情"""
    snapshot = await _get_owned_snapshot(snapshot_id, user, db)
    return _to_response(snapshot)


@router.delete(
    "/snapshots/{snapshot_id}",
    status_code=204,
    summary="删除快照",
)
async def delete_snapshot(snapshot_id: str, user: CurrentUser, db: DBSession):
    """删除指定快照"""
    snapshot = await _get_owned_snapshot(snapshot_id, user, db)
    await db.delete(snapshot)
    await db.commit()
    logger.info(f"[Snapshot:Delete] id={snapshot_id}")


@router.post(
    "/snapshots/{snapshot_id}/restore",
    response_model=SnapshotRestoreResponse,
    summary="恢复快照",
)
async def restore_snapshot(
    snapshot_id: str, user: CurrentUser, db: DBSession
):
    """恢复快照到实际 nodes/edges（单事务）

    1. 校验快照属于当前用户
    2. 读取 snapshot_data
    3. 删除项目现有 nodes/edges
    4. 从 snapshot_data 插入新 nodes/edges
    5. 刷新 project.updated_at
    6. 提交事务
    """
    snapshot = await _get_owned_snapshot(snapshot_id, user, db)
    data = snapshot.snapshot_data or {}
    nodes_data = data.get("nodes", [])
    edges_data = data.get("edges", [])
    pid = snapshot.project_id

    # 1. 删除旧数据：先边后节点（外键约束）
    await db.execute(
        delete(WorkflowEdge).where(WorkflowEdge.project_id == pid)
    )
    await db.execute(
        delete(WorkflowNode).where(WorkflowNode.project_id == pid)
    )

    # 2. 插入新节点
    for node_data in nodes_data:
        node = WorkflowNode(
            id=node_data["id"],
            project_id=pid,
            node_type=node_data.get("node_type") or node_data.get("type", "input"),
            label=node_data.get("label"),
            position_x=node_data.get("position_x", node_data.get("position", {}).get("x", 0)),
            position_y=node_data.get("position_y", node_data.get("position", {}).get("y", 0)),
            config=node_data.get("config") or node_data.get("data"),
        )
        db.add(node)

    # flush 确保节点先写入，避免外键冲突
    await db.flush()

    # 3. 插入新边
    for edge_data in edges_data:
        edge = WorkflowEdge(
            id=edge_data["id"],
            project_id=pid,
            source_node_id=edge_data.get("source_node_id") or edge_data["source"],
            target_node_id=edge_data.get("target_node_id") or edge_data["target"],
            source_port=edge_data.get("source_port") or edge_data.get("sourceHandle"),
            target_port=edge_data.get("target_port") or edge_data.get("targetHandle"),
        )
        db.add(edge)

    # 4. 刷新 project.updated_at
    project_result = await db.execute(
        select(Project).where(Project.id == pid)
    )
    project = project_result.scalar_one_or_none()
    if project:
        project.updated_at = datetime.utcnow()

    await db.commit()
    logger.info(
        f"[Snapshot:Restore] id={snapshot_id} project={pid} "
        f"nodes={len(nodes_data)} edges={len(edges_data)}"
    )
    return SnapshotRestoreResponse(
        restored=True,
        project_id=pid,
        nodes_count=len(nodes_data),
        edges_count=len(edges_data),
    )
