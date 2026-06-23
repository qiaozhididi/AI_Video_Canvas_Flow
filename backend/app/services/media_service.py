"""MinIO 上传/预签名 URL"""

from minio import Minio
from minio.error import S3Error

from app.config import settings


def get_minio_client() -> Minio:
    """创建 MinIO 客户端"""
    return Minio(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )


async def upload_file(bucket: str, object_name: str, file_data: bytes, content_type: str) -> str:
    """上传文件到 MinIO，返回对象键"""
    client = get_minio_client()
    # 确保桶存在
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)

    from io import BytesIO

    client.put_object(
        bucket_name=bucket,
        object_name=object_name,
        data=BytesIO(file_data),
        length=len(file_data),
        content_type=content_type,
    )
    return object_name


async def get_presigned_url(bucket: str, object_name: str, expires_hours: int = 1) -> str:
    """生成预签名下载 URL"""
    from datetime import timedelta

    client = get_minio_client()
    return client.presigned_get_object(
        bucket_name=bucket,
        object_name=object_name,
        expires=timedelta(hours=expires_hours),
    )


async def delete_file(bucket: str, object_name: str) -> None:
    """从 MinIO 删除文件"""
    client = get_minio_client()
    client.remove_object(bucket_name=bucket, object_name=object_name)
