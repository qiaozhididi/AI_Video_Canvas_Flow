"""Celery 任务包 — 导入所有任务模块以便 Celery 注册"""

from app.tasks.render_tasks import run_render_task  # noqa: F401