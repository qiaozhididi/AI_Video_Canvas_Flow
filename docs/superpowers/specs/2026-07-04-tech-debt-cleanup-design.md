# 技术债清理设计文档 (P0+P1)

## 概述

本文档记录 AI Canvas Flow 项目中发现的技术债，并规划 P0（必须修复）和 P1（应尽快修复）级别的修复方案。

---

## P0 — 必须立即修复

### TD-01: media.py 同步阻塞 I/O

**位置**: `backend/app/api/media.py:117`
**问题**: `download_media` 端点在 async 函数中使用 `urllib.request.urlopen()` 同步阻塞调用，会阻塞 FastAPI 事件循环，影响所有并发请求。
**修复**: 替换为 `httpx.AsyncClient` 异步下载。

```python
# Before
resp = urlopen(url)

# After
async with httpx.AsyncClient(timeout=60.0) as client:
    resp = await client.get(url)
```

### TD-02: RenderTask.node_id 字段长度不足

**位置**: `backend/app/models/render_task.py:26`
**问题**: `node_id` 定义为 `String(36)`，但前端生成的节点 ID 格式为 `"node-{timestamp}-{random}"`，长度可达 40+，WorkflowNode.id 定义为 `String(128)`。长度不匹配导致数据截断。
**修复**: 将 `RenderTask.node_id` 改为 `String(128)` 并生成 Alembic 迁移。

### TD-03: text_input artifact.type 硬编码为 'image'

**位置**: `frontend/src/utils/workflowExecutor.ts:68`
**问题**: 文本输入节点的虚拟 artifact.type 被硬编码为 `'image'`（注释说"使用 image 类型以通过 URL 检查"），类型语义错误。
**修复**:
1. 在 `canvas.ts` 的 Artifact type 中增加 `'text'` 类型
2. `collectUpstreamArtifacts` 中 text_input 使用 `type: 'text'`
3. 后端 `_execute_render_task` 的 artifact 透传逻辑同时匹配 `'image'` 和 `'text'`
4. 后端 `_do_img2img` 的图片 URL 提取逻辑不受 text 类型影响（仅匹配含图片特征的 URL）

### TD-04: 前后端 NODE_TEMPLATES 与 NODE_DEFAULT_PARAMS 不一致

**位置**: `frontend/src/types/canvas.ts:98-102` vs `backend/app/services/ai_service.py:612-631`
**问题**:
- size 默认值：前端 `'2k'` vs 后端 `'1024x1024'`
- model_id 字段：前端 AI 推理节点包含 `model_id: ''`，后端不包含
- 误导性注释声称两者一致

**修复**: 统一为后端值作为唯一真实来源，前端 NODE_TEMPLATES.defaultParams 与后端对齐：
- `text_to_image`: `{ prompt: '', size: '1024x1024' }` → 前端同步改为 `'1024x1024'`
- `image_to_image`: `{ prompt: '', size: '1024x1024' }` → 前端同步
- AI 推理节点统一包含 `model_id: ''`（后端也加上）

---

## P1 — 应尽快修复

### TD-05: render_tasks.py 5个函数大量重复代码

**位置**: `backend/app/tasks/render_tasks.py` 第 229-557 行
**问题**: `_do_text2img`、`_do_img2img`、`_do_img2video`、`_do_text2video`、`_do_tts` 五个函数结构近乎相同（更新状态→获取 owner_id→调 AI→异常处理→模拟 fallback→完成），约 200 行重复代码。
**修复**: 提取通用 `_do_ai_call()` 函数，用配置驱动差异：

```python
AI_TASK_CONFIG = {
    "ai_text2img": {"fn": call_image_gen, "default_prompt": "一张美丽的风景图", "needs_image": False, ...},
    "ai_img2img": {"fn": call_img2img, "default_prompt": "在原图基础上进行编辑", "needs_image": True, ...},
    ...
}

async def _do_ai_call(task_id, task_type, model_id, prompt, input_artifacts, node_params):
    config = AI_TASK_CONFIG[task_type]
    # 通用逻辑：更新状态、获取 owner_id、调 AI、异常处理、模拟 fallback
    if config["needs_image"]:
        image_url = _extract_image_url(input_artifacts)
        result = await config["fn"](db, model_id, prompt, image_url, ...)
    else:
        result = await config["fn"](db, model_id, prompt, ...)
```

### TD-06: ai_service.py 图片/视频/音频函数重复代码

**位置**: `backend/app/services/ai_service.py`
**问题**:
- `call_image_gen` 与 `call_img2img` 的响应处理逻辑近乎复制（MinIO 持久化+fallback）
- `call_video_gen` 与 `call_audio_gen` 整体结构高度重复（异步任务创建+轮询+URL提取+持久化）

**修复**:
1. 提取 `_handle_image_response(db, data, owner_id)` 处理图片 API 响应的 MinIO 持久化
2. 提取 `_call_ark_async(db, model_id, content, media_type, ...)` 泛化 Ark 异步任务调用

### TD-07: 模拟路径返回不可访问 URL 但标记 completed

**位置**: `render_tasks.py` 多处（如第 293 行 `"ai_result/{task_id}/image.png"`）
**问题**: 模拟生成的 URL 不是有效路径，前端无法下载，但 status 标记为 `"completed"`。
**修复**: 模拟路径也标记为 MinIO 持久化格式，或添加 `is_simulated` 标记让前端区分。最简方案：模拟结果标记 `status="completed"` 但 `result_url` 留空（前端显示"模拟完成"）。

### TD-08: PropertyPanel "执行节点"按钮使用模拟逻辑

**位置**: `frontend/src/components/panels/PropertyPanel.tsx:167-181`
**问题**: PropertyPanel 的"执行节点"按钮使用 setInterval 模拟进度，而非调用 `executeNode()` 真实执行 API。同一种操作两种完全不同的行为。
**修复**: 将 PropertyPanel 的执行按钮改为调用 `workflowExecutor.executeNode()`，与 CanvasNode 的重试按钮保持一致。

### TD-09: RenderCenter 缺少 ai_img2img/ai_text2video 选项

**位置**: `frontend/src/pages/RenderCenter.tsx:23-28`
**问题**: `TASK_TYPES` 只包含 4 种 task_type，缺少 `ai_img2img` 和 `ai_text2video`。同时 `TASK_TYPE_LABELS` 中有 `video_render`/`image_render`/`audio_render` 这些后端不存在的死代码。
**修复**:
1. `TASK_TYPES` 增加 `ai_img2img`（图生图）和 `ai_text2video`（文生视频）
2. 删除 `TASK_TYPE_LABELS` 中的 `video_render`/`image_render`/`audio_render` 死代码
3. 修正默认 `selectedTaskType` 为有效的 task_type

### TD-10: 轮询无超时/无最大重试

**位置**: `frontend/src/utils/apiClient.ts:465-487`
**问题**: `renderApi.poll` 使用 setTimeout 递归轮询，无最大重试次数或超时上限。Celery worker 挂掉时前端无限轮询。
**修复**: 添加 `MAX_POLL_ATTEMPTS = 120`（约 6 分钟）和 `POLL_TIMEOUT_MS = 360000`，超时后停止轮询并标记任务失败。

---

## 不在本次修复范围内（P2，后续迭代）

- SECRET_KEY 启动校验
- datetime.utcnow() 废弃用法
- updateNodeData/addEdge 不写历史记录
- 前后端映射重复定义
- User 模型缺少时间字段
- 数据库索引缺失
- 跨域 URL 下载方式
- audio_input 节点虚拟 artifact
- 死代码清理
