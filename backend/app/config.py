"""Pydantic Settings 配置：数据库/Redis/MinIO/Celery 等环境变量"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用全局配置，从 .env 文件或环境变量读取"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # 项目基础信息
    PROJECT_NAME: str = "ai-canvas-flow-backend"
    VERSION: str = "0.1.0"
    DEBUG: bool = False

    # 数据库（PostgreSQL + asyncpg）
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_canvas_flow"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # MinIO 对象存储
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "ai-canvas-flow"
    MINIO_SECURE: bool = False

    # JWT 认证
    SECRET_KEY: str = "change-me-to-a-secure-random-string"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    ALGORITHM: str = "HS256"

    # Celery（RabbitMQ broker）
    CELERY_BROKER_URL: str = "amqp://guest:guest@localhost:5672//"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"

    # CORS 允许的来源
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]


settings = Settings()
