"""媒体资产路由：上传/下载/预签名 URL"""

from uuid import UUID

from fastapi import APIRouter, UploadFile

from app.deps import CurrentUser, DBSession
from app.schemas.media import MediaAssetResponse

router = APIRouter()


@router.get("/", response_model=list[MediaAssetResponse], summary="获取媒体资产列表")
async def list_media(user: CurrentUser, db: DBSession):
    """获取当前用户的媒体资产列表"""
    # TODO: 查询媒体资产
    return []


@router.post("/upload", response_model=MediaAssetResponse, summary="上传媒体文件")
async def upload_media(file: UploadFile, user: CurrentUser, db: DBSession):
    """上传媒体文件到 MinIO"""
    # TODO: 调用 media_service 上传
    return None


@router.get("/{asset_id}", response_model=MediaAssetResponse, summary="获取媒体资产详情")
async def get_media(asset_id: UUID, user: CurrentUser, db: DBSession):
    """获取指定媒体资产详情"""
    # TODO: 查询媒体资产
    return None


@router.get("/{asset_id}/presign", summary="获取预签名下载 URL")
async def get_presigned_url(asset_id: UUID, user: CurrentUser, db: DBSession):
    """获取媒体文件的预签名下载 URL"""
    # TODO: 调用 media_service 生成预签名 URL
    return {"url": "placeholder"}


@router.delete("/{asset_id}", status_code=204, summary="删除媒体资产")
async def delete_media(asset_id: UUID, user: CurrentUser, db: DBSession):
    """删除指定媒体资产"""
    # TODO: 调用 media_service 删除
