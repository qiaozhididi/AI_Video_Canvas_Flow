"""媒体资产路由：上传/下载/预签名 URL"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, DBSession
from app.models.media_asset import MediaAsset

logger = logging.getLogger("app.api.media")

router = APIRouter()


@router.get("/", summary="获取媒体资产列表")
async def list_media(user: CurrentUser, db: DBSession):
    """获取当前用户的媒体资产列表"""
    owner_id = uuid.UUID(user)
    result = await db.execute(
        select(MediaAsset).where(MediaAsset.owner_id == owner_id)
    )
    assets = result.scalars().all()
    return [_asset_to_dict(a) for a in assets]


@router.post("/upload", summary="上传媒体文件")
async def upload_media(file: UploadFile, user: CurrentUser, db: DBSession):
    """上传媒体文件（开发模式：文件内容暂存内存，元数据写入数据库）"""
    content = await file.read()
    owner_id = uuid.UUID(user)
    asset_id = uuid.uuid4()
    now = datetime.utcnow()
    storage_key = f"media/{user}/{asset_id}/{file.filename}"

    asset = MediaAsset(
        id=asset_id,
        owner_id=owner_id,
        project_id=None,
        file_name=file.filename or "unknown",
        file_type=file.content_type or "application/octet-stream",
        file_size=len(content),
        storage_key=storage_key,
        thumbnail_key=None,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    logger.info(f"[Media:Upload] id={asset.id} file={file.filename} size={len(content)} user={user}")
    return _asset_to_dict(asset)


@router.get("/{asset_id}", summary="获取媒体资产详情")
async def get_media(asset_id: str, user: CurrentUser, db: DBSession):
    """获取指定媒体资产详情"""
    asset = await _get_asset(asset_id, db)
    return _asset_to_dict(asset)


@router.get("/{asset_id}/presign", summary="获取预签名下载 URL")
async def get_presigned_url(asset_id: str, user: CurrentUser, db: DBSession):
    """获取媒体文件的预签名下载 URL（开发模式：返回占位 URL）"""
    asset = await _get_asset(asset_id, db)
    return {"url": f"http://localhost:9000/ai-canvas-flow/{asset.storage_key}", "expires_in": 3600}


@router.delete("/{asset_id}", status_code=204, summary="删除媒体资产")
async def delete_media(asset_id: str, user: CurrentUser, db: DBSession):
    """删除指定媒体资产"""
    asset = await _get_asset(asset_id, db)
    await db.delete(asset)
    await db.commit()
    logger.info(f"[Media:Delete] id={asset_id}")


async def _get_asset(asset_id: str, db: DBSession) -> MediaAsset:
    """根据 ID 查询媒体资产，不存在则 404"""
    result = await db.execute(
        select(MediaAsset).where(MediaAsset.id == uuid.UUID(asset_id))
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="媒体资产不存在")
    return asset


def _asset_to_dict(asset: MediaAsset) -> dict:
    """将 ORM 对象转为与原内存存储一致的字典格式"""
    return {
        "id": str(asset.id),
        "owner_id": str(asset.owner_id),
        "project_id": str(asset.project_id) if asset.project_id else None,
        "file_name": asset.file_name,
        "file_type": asset.file_type,
        "file_size": asset.file_size,
        "storage_key": asset.storage_key,
        "thumbnail_key": asset.thumbnail_key,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
    }
