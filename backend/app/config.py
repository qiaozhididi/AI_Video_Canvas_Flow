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
    PORT: int = 8000

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

    # CORS 允许的来源（5173-5183 覆盖 Vite 开发服务器端口范围）
    CORS_ORIGINS: list[str] = [f"http://localhost:{p}" for p in range(5173, 5184)]

    # 默认 AI 配置（首次启动自动创建 Provider/Model）
    DEFAULT_AI_PROVIDER_NAME: str = "火山引擎"
    DEFAULT_AI_PLATFORM: str = "volcengine"
    DEFAULT_AI_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    DEFAULT_AI_API_KEY: str = ""
    DEFAULT_AI_MODEL_ID: str = "doubao-seed-2-1-turbo-260628"
    DEFAULT_AI_MODEL_DISPLAY_NAME: str = "豆包 Seed 2.1 Turbo"
    DEFAULT_AI_MODEL_TYPE: str = "llm"


settings = Settings()
