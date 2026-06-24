"""媒体资产路由：上传/下载/预签名 URL（开发模式：内存存储）"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from app.deps import CurrentUser

logger = logging.getLogger("app.api.media")

router = APIRouter()

# 开发用内存存储
_dev_media: dict[str, dict] = {}


@router.get("/", summary="获取媒体资产列表")
async def list_media(user: CurrentUser):
    """获取当前用户的媒体资产列表"""
    return [m for m in _dev_media.values() if m["owner_id"] == user]


@router.post("/upload", summary="上传媒体文件")
async def upload_media(file: UploadFile, user: CurrentUser):
    """上传媒体文件（开发模式：保存到内存，记录元数据）"""
    content = await file.read()
    asset_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    storage_key = f"media/{user}/{asset_id}/{file.filename}"

    asset = {
        "id": asset_id,
        "owner_id": user,
        "project_id": None,
        "file_name": file.filename or "unknown",
        "file_type": file.content_type or "application/octet-stream",
        "file_size": len(content),
        "storage_key": storage_key,
        "thumbnail_key": None,
        "created_at": now,
        "updated_at": now,
    }
    _dev_media[asset_id] = asset

    logger.info(f"[Media:Upload] id={asset_id} file={file.filename} size={len(content)} user={user}")
    return asset


@router.get("/{asset_id}", summary="获取媒体资产详情")
async def get_media(asset_id: str, user: CurrentUser):
    """获取指定媒体资产详情"""
    asset = _dev_media.get(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="媒体资产不存在")
    return asset


@router.get("/{asset_id}/presign", summary="获取预签名下载 URL")
async def get_presigned_url(asset_id: str, user: CurrentUser):
    """获取媒体文件的预签名下载 URL（开发模式：返回占位 URL）"""
    asset = _dev_media.get(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="媒体资产不存在")
    return {"url": f"http://localhost:9000/ai-canvas-flow/{asset['storage_key']}", "expires_in": 3600}


@router.delete("/{asset_id}", status_code=204, summary="删除媒体资产")
async def delete_media(asset_id: str, user: CurrentUser):
    """删除指定媒体资产"""
    if asset_id not in _dev_media:
        raise HTTPException(status_code=404, detail="媒体资产不存在")
    del _dev_media[asset_id]
    logger.info(f"[Media:Delete] id={asset_id}")
