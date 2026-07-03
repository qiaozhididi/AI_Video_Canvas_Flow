"""媒体资产路由：上传/下载/预签名 URL"""

import logging
import uuid
from datetime import datetime
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.deps import CurrentUser, DBSession
from app.models.media_asset import MediaAsset
from app.services.media_service import upload_file, get_presigned_url, delete_file
from app.config import settings

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
    """上传媒体文件到 MinIO，元数据写入数据库"""
    content = await file.read()
    owner_id = uuid.UUID(user)
    asset_id = uuid.uuid4()
    now = datetime.utcnow()
    storage_key = f"media/{user}/{asset_id}/{file.filename}"

    # 上传文件到 MinIO
    try:
        await upload_file(
            bucket=settings.MINIO_BUCKET,
            object_name=storage_key,
            file_data=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        logger.error(f"[Media:Upload] MinIO 上传失败: {e}")
        raise HTTPException(status_code=500, detail="文件存储失败")

    # 元数据写入数据库
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
    asset = await _get_asset(asset_id, user, db)
    return _asset_to_dict(asset)


@router.get("/{asset_id}/presign", summary="获取预签名下载 URL")
async def get_presigned_url_api(asset_id: str, user: CurrentUser, db: DBSession):
    """获取媒体文件的 MinIO 预签名下载 URL"""
    asset = await _get_asset(asset_id, user, db)
    try:
        url = await get_presigned_url(
            bucket=settings.MINIO_BUCKET,
            object_name=asset.storage_key,
            expires_hours=1,
        )
        return {"url": url, "expires_in": 3600}
    except Exception as e:
        logger.error(f"[Media:Presign] 生成预签名 URL 失败: {e}")
        raise HTTPException(status_code=500, detail="生成下载链接失败")


@router.get("/{asset_id}/download", summary="直接下载媒体文件")
async def download_media(asset_id: str, user: CurrentUser, db: DBSession):
    """通过后端代理下载媒体文件，避免前端跨域问题"""
    asset = await _get_asset(asset_id, user, db)
    try:
        url = await get_presigned_url(
            bucket=settings.MINIO_BUCKET,
            object_name=asset.storage_key,
            expires_hours=1,
        )
    except Exception as e:
        logger.error(f"[Media:Download] 生成预签名 URL 失败: {e}")
        raise HTTPException(status_code=500, detail="生成下载链接失败")

    try:
        resp = urlopen(url)
    except Exception as e:
        logger.error(f"[Media:Download] 从 MinIO 获取文件失败: {e}")
        raise HTTPException(status_code=500, detail="文件获取失败")

    from urllib.parse import quote
    encoded_filename = quote(asset.file_name)

    return StreamingResponse(
        resp,
        media_type=asset.file_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


@router.delete("/{asset_id}", status_code=204, summary="删除媒体资产")
async def delete_media(asset_id: str, user: CurrentUser, db: DBSession):
    """删除指定媒体资产（同时从 MinIO 删除文件）"""
    asset = await _get_asset(asset_id, user, db)

    # 从 MinIO 删除文件
    try:
        await delete_file(
            bucket=settings.MINIO_BUCKET,
            object_name=asset.storage_key,
        )
    except Exception as e:
        logger.warning(f"[Media:Delete] MinIO 删除失败（继续删除数据库记录）: {e}")

    await db.delete(asset)
    await db.commit()
    logger.info(f"[Media:Delete] id={asset_id}")


async def _get_asset(asset_id: str, user: str, db: DBSession) -> MediaAsset:
    """根据 ID 查询媒体资产，校验所有权，不存在则 404"""
    result = await db.execute(
        select(MediaAsset).where(MediaAsset.id == uuid.UUID(asset_id))
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="媒体资产不存在")
    if str(asset.owner_id) != user:
        raise HTTPException(status_code=403, detail="无权访问此资产")
    return asset


def _asset_to_dict(asset: MediaAsset) -> dict:
    """将 ORM 对象转为字典格式"""
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
