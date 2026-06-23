"""AI 推理任务：文生图/图生视频/TTS"""

from app.tasks.celery_app import celery_app


@celery_app.task(bind=True, name="run_ai_task")
def run_ai_task(self, project_id: str, task_type: str) -> dict:
    """AI 推理任务（骨架实现）

    Args:
        project_id: 项目 ID
        task_type: 任务类型（text2img / img2video / tts）
    """
    # 更新任务状态
    self.update_state(state="RUNNING", meta={"progress": 0.0})

    # TODO: 根据 task_type 调用对应的 AI 服务
    # - text2img: 调用 Stable Diffusion / DALL-E
    # - img2video: 调用视频生成模型
    # - tts: 调用 TTS 模型

    # 模拟进度更新
    for progress in [0.25, 0.5, 0.75, 1.0]:
        self.update_state(state="RUNNING", meta={"progress": progress})

    return {
        "project_id": project_id,
        "task_type": task_type,
        "status": "completed",
        "result_url": f"placeholder_result/{project_id}/{task_type}",
    }
