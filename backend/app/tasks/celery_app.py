"""Celery 实例配置：使用 RabbitMQ 作为 broker"""

from celery import Celery

from app.config import settings

celery_app = Celery(
    "ai-canvas-flow",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

# Celery 配置
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # RabbitMQ 4.x 要求所有队列 durable=True
    task_default_queue="celery",
    task_default_exchange="celery",
    task_default_routing_key="celery",
    task_default_durable=True,
    # RabbitMQ 4.x 兼容：禁用 gossip/mingle/pidbox 的 transient 队列
    worker_enable_remote_control=False,
    worker_send_task_events=False,
)

# 自动发现任务模块
celery_app.autodiscover_tasks(["app.tasks"])
