# AI 真实 API 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将图生视频、文生视频、文生语音从模拟实现升级为调用真实 AI API（火山引擎 Ark Seedance / Seed Audio），新增 text_to_video 节点类型。

**Architecture:** Celery 任务内创建远程异步任务 → 轮询等待完成 → 下载结果到 MinIO 持久化 → 更新 DB。与现有 _do_text2img 模式一致。

**Tech Stack:** Python/FastAPI/Celery/httpx/MinIO/SQLAlchemy (后端) + React/TypeScript/Zustand (前端)

## Global Constraints

- Celery 任务必须使用自己的 async engine + session factory（不能复用 FastAPI 的）
- progress 范围 0~100 整数
- Ark API 返回的 video_url/audio_url 24h 过期，必须下载到 MinIO
- result_url 必须为 `/api/v1/media/{asset_id}/download` 格式
- 无 model_id 时回退到模拟生成
- Git commit 使用简短中文描述

---

### Task 1: 后端 — 实现 call_video_gen 和 call_audio_gen

**Files:**
- Modify: `backend/app/services/ai_service.py:144-159`（替换 NotImplementedError 占位）

**Interfaces:**
- Consumes: `_get_provider_and_model(db, model_id, expected_type)`, `upload_file()`, `settings.MINIO_BUCKET`
- Produces:
  - `call_video_gen(db, model_id, prompt, image_url=None, params=None) -> dict` 返回 `{"video_url": "/api/v1/media/{asset_id}/download", "remote_task_id": "cgt-xxx"}`
  - `call_audio_gen(db, model_id, text, params=None) -> dict` 返回 `{"audio_url": "/api/v1/media/{asset_id}/download", "remote_task_id": "cgt-xxx"}`

- [ ] **Step 1: 在 ai_service.py 中删除 call_video_gen 的 NotImplementedError 占位，实现完整函数**

替换 `call_video_gen` 函数（当前在约 144 行），新实现如下：

```python
async def _poll_ark_task(
    provider: AiProvider, model: AiModel, remote_task_id: str, timeout: int = 300, interval: int = 5
) -> dict:
    """轮询 Ark contents/generations/tasks 异步任务直到完成

    Args:
        timeout: 最大等待秒数
        interval: 轮询间隔秒数

    Returns:
        查询任务的完整响应体

    Raises:
        RuntimeError: 超时 / 任务失败 / 过期
    """
    import asyncio as _asyncio

    url = f"{provider.base_url.rstrip('/')}/contents/generations/tasks/{remote_task_id}"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        elapsed = 0
        while elapsed < timeout:
            await _asyncio.sleep(interval)
            elapsed += interval

            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.warning(f"[Ark:Poll] GET 状态码 {resp.status_code}, 继续轮询")
                continue

            data = resp.json()
            status = data.get("status", "")

            if status == "succeeded":
                logger.info(f"[Ark:Poll] 任务 {remote_task_id} 成功")
                return data
            elif status in ("failed", "expired", "cancelled"):
                error_msg = data.get("error", {}).get("message", status)
                raise RuntimeError(f"Ark 任务 {remote_task_id} {status}: {error_msg}")
            # queued / running → 继续轮询

        raise RuntimeError(f"Ark 任务 {remote_task_id} 超时（{timeout}s）")


async def _download_to_minio(
    db, url: str, owner_id: str, filename: str, content_type: str
) -> str:
    """下载外部 URL 文件到 MinIO 并创建 MediaAsset 记录

    Returns:
        持久化 URL: /api/v1/media/{asset_id}/download
    """
    import uuid as _uuid
    from datetime import datetime, timezone
    from app.models.media_asset import MediaAsset

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise RuntimeError(f"下载文件失败: HTTP {resp.status_code}")
        file_data = resp.content

    asset_id = _uuid.uuid4()
    storage_key = f"ai_result/{owner_id}/{asset_id}/{filename}"

    await upload_file(
        bucket=settings.MINIO_BUCKET,
        object_name=storage_key,
        file_data=file_data,
        content_type=content_type,
    )

    now = datetime.now(timezone.utc)
    asset = MediaAsset(
        id=asset_id,
        owner_id=_uuid.UUID(owner_id),
        project_id=None,
        file_name=filename,
        file_type=content_type,
        file_size=len(file_data),
        storage_key=storage_key,
        thumbnail_key=None,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return f"/api/v1/media/{asset.id}/download"


async def call_video_gen(
    db, model_id: str, prompt: str, image_url: str | None = None, params: dict | None = None
) -> dict:
    """视频生成：调用 Ark contents/generations/tasks API

    Args:
        model_id: AI Model UUID（model_type 应为 video_gen）
        prompt: 视频描述提示词
        image_url: 首帧图片 URL（图生视频时传入，文生视频时不传）
        params: 额外参数（duration, ratio, resolution）

    Returns:
        {"video_url": "/api/v1/media/{asset_id}/download", "remote_task_id": "cgt-xxx"}
    """
    provider, model = await _get_provider_and_model(db, model_id, expected_type="video_gen")

    # 构建 content
    content: list[dict] = [{"type": "text", "text": prompt or "一段优美的视频"}]
    if image_url:
        content.append({"type": "image_url", "image_url": {"url": image_url}})

    body: dict = {"model": model.model_id, "content": content}
    if params:
        if "duration" in params:
            body["duration"] = int(params["duration"])

    url = f"{provider.base_url.rstrip('/')}/contents/generations/tasks"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }

    logger.info(f"[AI:VideoGen] 调用 {provider.name}/{model.display_name}, prompt={prompt[:50]}")

    # 创建异步任务
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=body, headers=headers)
        if resp.status_code not in (200, 201):
            error_text = resp.text[:500]
            raise RuntimeError(f"视频生成 API 调用失败: HTTP {resp.status_code}: {error_text}")

        data = resp.json()
        remote_task_id = data.get("id")
        if not remote_task_id:
            raise RuntimeError(f"视频生成 API 未返回任务 ID: {str(data)[:300]}")

    logger.info(f"[AI:VideoGen] 创建任务 {remote_task_id}")

    # 轮询等待
    result = await _poll_ark_task(provider, model, remote_task_id)

    # 提取 video_url
    video_url = result.get("content", {}).get("video_url")
    if not video_url:
        raise RuntimeError(f"视频生成任务成功但未返回 video_url: {str(result)[:300]}")

    # 获取 owner_id 用于 MinIO 持久化
    from sqlalchemy import select as _sel
    from app.models.render_task import RenderTask
    # 从 db session 上下文获取（由调用方传入的 db 已有 owner 信息）
    # owner_id 由 _do_img2video / _do_text2video 传入
    owner_id = params.get("_owner_id", "") if params else ""

    # 下载到 MinIO
    if owner_id:
        persistent_url = await _download_to_minio(
            db, video_url, owner_id, f"video_{remote_task_id}.mp4", "video/mp4"
        )
    else:
        # 无法持久化，直接使用临时 URL
        persistent_url = video_url
        logger.warning("[AI:VideoGen] 无 owner_id，使用临时 URL（24h 过期）")

    return {"video_url": persistent_url, "remote_task_id": remote_task_id}


async def call_audio_gen(
    db, model_id: str, text: str, params: dict | None = None
) -> dict:
    """音频生成：调用 Ark contents/generations/tasks API

    Args:
        model_id: AI Model UUID（model_type 应为 tts）
        text: 文本内容
        params: 额外参数

    Returns:
        {"audio_url": "/api/v1/media/{asset_id}/download", "remote_task_id": "cgt-xxx"}
    """
    provider, model = await _get_provider_and_model(db, model_id, expected_type="tts")

    content: list[dict] = [{"type": "text", "text": text or "这是一段测试音频"}]

    body: dict = {"model": model.model_id, "content": content}

    url = f"{provider.base_url.rstrip('/')}/contents/generations/tasks"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }

    logger.info(f"[AI:AudioGen] 调用 {provider.name}/{model.display_name}, text={text[:50]}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=body, headers=headers)
        if resp.status_code not in (200, 201):
            error_text = resp.text[:500]
            raise RuntimeError(f"音频生成 API 调用失败: HTTP {resp.status_code}: {error_text}")

        data = resp.json()
        remote_task_id = data.get("id")
        if not remote_task_id:
            raise RuntimeError(f"音频生成 API 未返回任务 ID: {str(data)[:300]}")

    logger.info(f"[AI:AudioGen] 创建任务 {remote_task_id}")

    result = await _poll_ark_task(provider, model, remote_task_id)

    audio_url = result.get("content", {}).get("audio_url")
    if not audio_url:
        raise RuntimeError(f"音频生成任务成功但未返回 audio_url: {str(result)[:300]}")

    owner_id = params.get("_owner_id", "") if params else ""

    if owner_id:
        persistent_url = await _download_to_minio(
            db, audio_url, owner_id, f"audio_{remote_task_id}.mp3", "audio/mpeg"
        )
    else:
        persistent_url = audio_url
        logger.warning("[AI:AudioGen] 无 owner_id，使用临时 URL（24h 过期）")

    return {"audio_url": persistent_url, "remote_task_id": remote_task_id}
```

- [ ] **Step 2: 确认 ai_service.py 顶部 import 区域包含 httpx**

检查 ai_service.py 已有 `import httpx`（第 11 行），无需额外添加。

- [ ] **Step 3: 运行 Python 语法检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/backend && python -c "import ast; ast.parse(open('app/services/ai_service.py').read()); print('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/ai_service.py
git commit -m "实现call_video_gen和call_audio_gen"
```

---

### Task 2: 后端 — 更新 render_tasks.py（图生视频、文生视频、语音）

**Files:**
- Modify: `backend/app/tasks/render_tasks.py:296-323`（替换 _do_img2video 和 _do_tts 的模拟实现）
- Modify: `backend/app/tasks/render_tasks.py:180-221`（更新 _execute_ai_task 路由）

**Interfaces:**
- Consumes: `call_video_gen(db, model_id, prompt, image_url, params)` from Task 1
- Consumes: `call_audio_gen(db, model_id, text, params)` from Task 1
- Produces: `_do_img2video()` 使用真实 API，`_do_text2video()` 新函数，`_do_tts()` 使用真实 API

- [ ] **Step 1: 添加 _extract_image_url_from_artifacts 辅助函数**

在 `_extract_text_from_artifacts` 函数之后（约 178 行后）添加：

```python
def _extract_image_url_from_artifacts(artifacts: list[dict] | None) -> str:
    """从 input_artifacts 中提取图片 URL

    优先提取 type=image 的 artifact URL
    """
    if not artifacts:
        return ""
    for a in artifacts:
        if a.get("type") == "image" and a.get("url"):
            url = a["url"]
            # 内部相对路径加 /api/v1/media/ 前缀（Ark API 需要公网 URL）
            if url and not url.startswith("http"):
                url = f"/api/v1/media/{url}"
            return url
    return ""
```

- [ ] **Step 2: 替换 _do_img2video 的模拟实现**

将当前 `_do_img2video` 函数（约 296-308 行）替换为：

```python
async def _do_img2video(task_id: str, model_id: str | None, prompt: str, input_artifacts: list[dict] | None = None, node_params: dict | None = None) -> dict:
    """图生视频：从上游获取图片 URL，调用 call_video_gen"""
    from app.services.ai_service import call_video_gen

    sf = _get_celery_session_factory()

    # 获取 owner_id 用于 MinIO 持久化
    owner_id = ""
    async with sf() as db:
        from sqlalchemy import select
        from app.models.render_task import RenderTask
        result = await db.execute(select(RenderTask.owner_id).where(RenderTask.id == uuid.UUID(task_id)))
        row = result.one_or_none()
        if row:
            owner_id = str(row[0])
        await _update_task(db, task_id, status="running", progress=10)

    # 从 input_artifacts 或 node_params 提取 image_url
    image_url = _extract_image_url_from_artifacts(input_artifacts)
    if not image_url and node_params:
        url = node_params.get("url", "")
        if url and not url.startswith("http"):
            url = f"/api/v1/media/{url}"
        image_url = url

    if not prompt:
        prompt = "一段优美的视频动画"

    # 构建带 _owner_id 的 params
    params_with_owner = dict(node_params or {})
    params_with_owner["_owner_id"] = owner_id

    result_url = ""
    try:
        if model_id:
            async with sf() as db:
                await _update_task(db, task_id, progress=30)

            result = await call_video_gen(db, model_id, prompt, image_url, params_with_owner)
            result_url = result["video_url"]

            async with sf() as db:
                await _update_task(db, task_id, progress=90)
        else:
            # 无模型，回退模拟
            logger.warning(f"[AI:Img2Video] 无 model_id，回退模拟生成")
            async with sf() as db:
                for p in [30, 60, 90]:
                    await asyncio.sleep(2)
                    await _update_task(db, task_id, progress=p)
                result_url = f"ai_result/{task_id}/video.mp4"
    except ValueError as e:
        logger.warning(f"[AI:Img2Video] 模型不匹配，回退模拟: {e}")
        async with sf() as db:
            for p in [30, 60, 90]:
                await asyncio.sleep(2)
                await _update_task(db, task_id, progress=p)
            result_url = f"ai_result/{task_id}/video.mp4"
    except Exception as e:
        logger.error(f"[AI:Img2Video] 调用失败: {e}", exc_info=True)
        async with sf() as db:
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
        return {"task_id": task_id, "status": "failed", "error": str(e)}

    async with sf() as db:
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)

    return {"task_id": task_id, "status": "completed", "result_url": result_url}
```

- [ ] **Step 3: 新增 _do_text2video 函数**

在 `_do_img2video` 函数之后添加：

```python
async def _do_text2video(task_id: str, model_id: str | None, prompt: str, input_artifacts: list[dict] | None = None, node_params: dict | None = None) -> dict:
    """文生视频：仅文本输入，调用 call_video_gen(image_url=None)"""
    from app.services.ai_service import call_video_gen

    sf = _get_celery_session_factory()

    # 获取 owner_id
    owner_id = ""
    async with sf() as db:
        from sqlalchemy import select
        from app.models.render_task import RenderTask
        result = await db.execute(select(RenderTask.owner_id).where(RenderTask.id == uuid.UUID(task_id)))
        row = result.one_or_none()
        if row:
            owner_id = str(row[0])
        await _update_task(db, task_id, status="running", progress=10)

    if not prompt:
        prompt = "一段优美的视频"

    params_with_owner = dict(node_params or {})
    params_with_owner["_owner_id"] = owner_id

    result_url = ""
    try:
        if model_id:
            async with sf() as db:
                await _update_task(db, task_id, progress=30)

            result = await call_video_gen(db, model_id, prompt, image_url=None, params=params_with_owner)
            result_url = result["video_url"]

            async with sf() as db:
                await _update_task(db, task_id, progress=90)
        else:
            logger.warning(f"[AI:Text2Video] 无 model_id，回退模拟生成")
            async with sf() as db:
                for p in [30, 60, 90]:
                    await asyncio.sleep(2)
                    await _update_task(db, task_id, progress=p)
                result_url = f"ai_result/{task_id}/video.mp4"
    except ValueError as e:
        logger.warning(f"[AI:Text2Video] 模型不匹配，回退模拟: {e}")
        async with sf() as db:
            for p in [30, 60, 90]:
                await asyncio.sleep(2)
                await _update_task(db, task_id, progress=p)
            result_url = f"ai_result/{task_id}/video.mp4"
    except Exception as e:
        logger.error(f"[AI:Text2Video] 调用失败: {e}", exc_info=True)
        async with sf() as db:
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
        return {"task_id": task_id, "status": "failed", "error": str(e)}

    async with sf() as db:
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)

    return {"task_id": task_id, "status": "completed", "result_url": result_url}
```

- [ ] **Step 4: 替换 _do_tts 的模拟实现**

将当前 `_do_tts` 函数（约 311-323 行）替换为：

```python
async def _do_tts(task_id: str, model_id: str | None, prompt: str, node_params: dict | None = None) -> dict:
    """文生语音：调用 call_audio_gen"""
    from app.services.ai_service import call_audio_gen

    sf = _get_celery_session_factory()

    # 获取 owner_id
    owner_id = ""
    async with sf() as db:
        from sqlalchemy import select
        from app.models.render_task import RenderTask
        result = await db.execute(select(RenderTask.owner_id).where(RenderTask.id == uuid.UUID(task_id)))
        row = result.one_or_none()
        if row:
            owner_id = str(row[0])
        await _update_task(db, task_id, status="running", progress=10)

    text = prompt or ""
    if not text and node_params:
        text = node_params.get("text") or node_params.get("prompt") or ""
    if not text:
        text = "这是一段测试音频"

    params_with_owner = dict(node_params or {})
    params_with_owner["_owner_id"] = owner_id

    result_url = ""
    try:
        if model_id:
            async with sf() as db:
                await _update_task(db, task_id, progress=30)

            result = await call_audio_gen(db, model_id, text, params_with_owner)
            result_url = result["audio_url"]

            async with sf() as db:
                await _update_task(db, task_id, progress=90)
        else:
            logger.warning(f"[AI:TTS] 无 model_id，回退模拟生成")
            async with sf() as db:
                for p in [30, 60, 90]:
                    await asyncio.sleep(1)
                    await _update_task(db, task_id, progress=p)
                result_url = f"ai_result/{task_id}/audio.mp3"
    except ValueError as e:
        logger.warning(f"[AI:TTS] 模型不匹配，回退模拟: {e}")
        async with sf() as db:
            for p in [30, 60, 90]:
                await asyncio.sleep(1)
                await _update_task(db, task_id, progress=p)
            result_url = f"ai_result/{task_id}/audio.mp3"
    except Exception as e:
        logger.error(f"[AI:TTS] 调用失败: {e}", exc_info=True)
        async with sf() as db:
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
        return {"task_id": task_id, "status": "failed", "error": str(e)}

    async with sf() as db:
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)

    return {"task_id": task_id, "status": "completed", "result_url": result_url}
```

- [ ] **Step 5: 在 _execute_ai_task 中新增 ai_text2video 路由**

在 `_execute_ai_task` 函数中（约 214-221 行），在 `elif task_type == "ai_img2video":` 之前添加：

```python
    elif task_type == "ai_text2video":
        return await _do_text2video(task_id, model_id, user_content, input_artifacts, node_params)
```

最终路由部分应为：
```python
    if task_type == "ai_text2img":
        return await _do_text2img(task_id, model_id, user_content, input_artifacts, node_params)
    elif task_type == "ai_text2video":
        return await _do_text2video(task_id, model_id, user_content, input_artifacts, node_params)
    elif task_type == "ai_img2video":
        return await _do_img2video(task_id, model_id, user_content, input_artifacts, node_params)
    elif task_type == "ai_tts":
        return await _do_tts(task_id, model_id, user_content, node_params)
    else:
        return await _do_llm(task_id, model_id, user_content)
```

- [ ] **Step 6: 运行 Python 语法检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/backend && python -c "import ast; ast.parse(open('app/tasks/render_tasks.py').read()); print('OK')"`

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/app/tasks/render_tasks.py
git commit -m "更新图生视频/文生视频/语音为真实API调用"
```

---

### Task 3: 后端 — 更新 ai_service.py 节点配置

**Files:**
- Modify: `backend/app/services/ai_service.py:169-237`（NODE_WHITELIST, NODE_DEFAULT_LABELS, NODE_DEFAULT_PARAMS, AI_INFERENCE_MODEL_TYPE）

**Interfaces:**
- Consumes: 无（纯配置更新）
- Produces: `text_to_video` 节点在 AI 生成工作流和默认模型查找中可用

- [ ] **Step 1: 在 NODE_WHITELIST 中新增 text_to_video**

在 `"text_to_speech": "ai_inference",` 之后添加：

```python
    "text_to_video": "ai_inference",
```

- [ ] **Step 2: 在 NODE_DEFAULT_LABELS 中新增 text_to_video**

在 `"text_to_speech": "文生语音",` 之后添加：

```python
    "text_to_video": "文生视频",
```

- [ ] **Step 3: 在 NODE_DEFAULT_PARAMS 中新增 text_to_video**

在 `"text_to_speech": {"text": "", "voice": "default"},` 之后添加：

```python
    "text_to_video": {"prompt": "", "duration": 5},
```

- [ ] **Step 4: 在 AI_INFERENCE_MODEL_TYPE 中新增 text_to_video**

在 `"text_to_speech": "tts",` 之后添加：

```python
    "text_to_video": "video_gen",
```

- [ ] **Step 5: 在 SYSTEM_PROMPT 的合法节点类型列表中新增 text_to_video**

在 SYSTEM_PROMPT 字符串中的 `- AI 推理:text_to_image(文生图), image_to_video(图生视频), text_to_speech(文生语音)` 这一行后追加 `, text_to_video(文生视频)`：

```
- AI 推理:text_to_image(文生图), image_to_video(图生视频), text_to_speech(文生语音), text_to_video(文生视频)
```

- [ ] **Step 6: 运行 Python 语法检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/backend && python -c "import ast; ast.parse(open('app/services/ai_service.py').read()); print('OK')"`

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/ai_service.py
git commit -m "新增text_to_video节点配置"
```

---

### Task 4: 前端 — 新增 text_to_video 节点类型和更新模板

**Files:**
- Modify: `frontend/src/types/canvas.ts:11,92-114`
- Modify: `frontend/src/utils/workflowExecutor.ts:18-34,169-173`

**Interfaces:**
- Consumes: 后端 NODE_DEFAULT_PARAMS (text_to_video: {prompt, duration})
- Produces: `text_to_video` 节点在画布中可用，task_type 映射为 `ai_text2video`

- [ ] **Step 1: 在 canvas.ts 中更新 AIInferenceSubtype 类型**

将 `AIInferenceSubtype` 类型（第 11 行）从：
```typescript
export type AIInferenceSubtype = 'text_to_image' | 'image_to_video' | 'text_to_speech';
```
改为：
```typescript
export type AIInferenceSubtype = 'text_to_image' | 'image_to_video' | 'text_to_video' | 'text_to_speech';
```

- [ ] **Step 2: 在 NODE_TEMPLATES 中添加 text_to_video 节点并补充 model_id**

在 `text_to_speech` 条目之后添加 `text_to_video`，同时为 `image_to_video` 和 `text_to_speech` 补充 `model_id`：

```typescript
  { type: 'ai_inference', subtype: 'text_to_image', label: '文生图', icon: 'Wand2', category: 'AI 推理', defaultParams: { prompt: '', size: '2k' } },
  { type: 'ai_inference', subtype: 'image_to_video', label: '图生视频', icon: 'Video', category: 'AI 推理', defaultParams: { prompt: '', duration: 5, model_id: '' } },
  { type: 'ai_inference', subtype: 'text_to_video', label: '文生视频', icon: 'Video', category: 'AI 推理', defaultParams: { prompt: '', duration: 5, model_id: '' } },
  { type: 'ai_inference', subtype: 'text_to_speech', label: '文生语音', icon: 'Mic', category: 'AI 推理', defaultParams: { text: '', voice: 'default', model_id: '' } },
```

- [ ] **Step 3: 在 workflowExecutor.ts 中更新 EXECUTABLE_SUBTYPES 和 AI_SUBTYPES**

在 EXECUTABLE_SUBTYPES（第 18-22 行）中添加 `'text_to_video'`：
```typescript
const EXECUTABLE_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_video', 'text_to_video', 'text_to_speech',
  'upscale', 'style_transfer', 'remove_bg', 'extend_image',
  'video_output', 'image_output', 'audio_output',
]);
```

在 AI_SUBTYPES（第 24-26 行）中添加 `'text_to_video'`：
```typescript
const AI_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_video', 'text_to_video', 'text_to_speech',
]);
```

- [ ] **Step 4: 在 workflowExecutor.ts 的 getTaskType 中添加 text_to_video 映射**

在 `getTaskType` 函数（第 29-34 行）中，在 `image_to_video` 映射之后添加：
```typescript
  if (subtype === 'text_to_video') return 'ai_text2video';
```

- [ ] **Step 5: 在 workflowExecutor.ts 的 artifact 类型判断中添加 ai_text2video**

在 `executeNode` 函数中（约第 169-173 行），artifact 类型的三元链中添加 `ai_text2video` 判断：

```typescript
          type: (node.data.subtype === 'image_output' || node.data.subtype === 'upscale') ? 'image'
            : taskType.startsWith('ai_text2img') ? 'image'
            : taskType.startsWith('ai_img2video') ? 'video'
            : taskType.startsWith('ai_text2video') ? 'video'
            : taskType.startsWith('ai_tts') ? 'audio'
            : 'video',
```

- [ ] **Step 6: 运行 TypeScript 编译检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: 无错误输出

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/canvas.ts frontend/src/utils/workflowExecutor.ts
git commit -m "前端新增text_to_video节点类型"
```

---

### Task 5: 更新 RenderTaskCreate schema 和 render.py 的 task_type 注释

**Files:**
- Modify: `backend/app/api/render.py:19-26`（更新 RenderTaskCreate 的 task_type 注释）

**Interfaces:**
- Consumes: 无
- Produces: `ai_text2video` 作为合法 task_type 文档化

- [ ] **Step 1: 更新 RenderTaskCreate 的 task_type 注释**

将：
```python
    task_type: str = "render"  # render / ai_text2img / ai_img2video / ai_tts
```
改为：
```python
    task_type: str = "render"  # render / ai_text2img / ai_text2video / ai_img2video / ai_tts
```

- [ ] **Step 2: 更新 RenderTask 模型的 task_type 注释**

在 `backend/app/models/render_task.py` 第 20 行，将：
```python
    task_type: Mapped[str] = mapped_column(String(64))  # render / ai_text2img / ai_img2video / ai_tts
```
改为：
```python
    task_type: Mapped[str] = mapped_column(String(64))  # render / ai_text2img / ai_text2video / ai_img2video / ai_tts
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/render.py backend/app/models/render_task.py
git commit -m "文档更新：新增ai_text2video任务类型"
```

---

### Task 6: 验证 + 路线图更新

**Files:**
- Modify: `DEVELOPMENT_ROADMAP.md`（新增任务 #13）

**Interfaces:**
- Consumes: 所有前序任务的实现
- Produces: 路线图更新，记录本次功能完成

- [ ] **Step 1: 运行前端 TypeScript 编译检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: 无错误

- [ ] **Step 2: 运行后端语法检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/backend && python -c "import ast; ast.parse(open('app/services/ai_service.py').read()); ast.parse(open('app/tasks/render_tasks.py').read()); print('OK')"`

Expected: `OK`

- [ ] **Step 3: 运行前端单元测试**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/frontend && npm test -- --run 2>&1 | tail -20`

Expected: 全部通过

- [ ] **Step 4: 更新 DEVELOPMENT_ROADMAP.md**

在「## ✅ 已完成任务」部分的第 12 项之后添加第 13 项：

```markdown
### 13. AI 任务真实 API 实现（图生视频 + 文生视频 + 语音）
- **后端**: ai_service.py 新增 `call_video_gen` / `call_audio_gen`（Ark contents/generations/tasks 异步 API + 轮询 + MinIO 持久化）
- **后端**: render_tasks.py `_do_img2video` / `_do_tts` 从模拟升级为真实 API 调用（无 model_id 时回退模拟）
- **后端**: 新增 `_do_text2video` 函数 + `ai_text2video` task_type 路由
- **后端**: `_poll_ark_task` 通用轮询函数（5s 间隔，300s 超时）
- **后端**: `_download_to_minio` 下载临时 URL 到 MinIO + 创建 MediaAsset 记录
- **后端**: ai_service.py 新增 `text_to_video` 节点配置（NODE_WHITELIST / NODE_DEFAULT_PARAMS / AI_INFERENCE_MODEL_TYPE）
- **前端**: canvas.ts 新增 `text_to_video` 子类型和 NODE_TEMPLATES 条目
- **前端**: workflowExecutor.ts 新增 `ai_text2video` task_type 映射和 EXECUTABLE_SUBTYPES / AI_SUBTYPES
- **前端**: image_to_video / text_to_speech 节点 defaultParams 补充 model_id 字段
- **涉及文件**: ai_service.py, render_tasks.py, canvas.ts, workflowExecutor.ts, render.py, render_task.py
```

同时更新「当前项目状态概览」表格中「执行工作流」行，补充「文生视频」说明。

- [ ] **Step 5: Commit**

```bash
git add DEVELOPMENT_ROADMAP.md
git commit -m "更新路线图：AI真实API实现已完成"
```
