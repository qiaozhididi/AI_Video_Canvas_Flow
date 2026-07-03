# AI 任务真实 API 实现设计

> 日期: 2026-07-04
> 状态: 已批准

## 背景

当前 `_do_img2video` 和 `_do_tts` 均为模拟实现（`asyncio.sleep` + 占位 result_url）。需要接入真实的 AI API：

- **图生视频 / 文生视频**: 火山引擎 Ark Seedance API (`doubao-seedance-2-0-260128`)
- **文生语音 / 音频生成**: 火山引擎 Ark Seed Audio API (`doubao-seed-audio-1-0`)

## 架构决策

**方案选择**: Celery 同步等待模式

Celery 任务内创建远程异步任务 → 轮询等待完成 → 下载结果到 MinIO → 更新 DB。

理由：
- 与现有 `_do_text2img` 模式一致
- 视频生成本身耗时 30-150s，Celery worker 等待合理
- 架构最简，无需新增轮询调度器或回调机制

## API 规范

### Seedance 视频生成 API

- **创建任务**: `POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- **查询任务**: `GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}`
- **鉴权**: `Authorization: Bearer {api_key}`
- **状态流转**: queued → running → succeeded / failed / expired / cancelled
- **结果**: `content.video_url`（24h 过期）

创建请求体（图生视频）:
```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {"type": "text", "text": "镜头缓慢推进，人物转身微笑"},
    {"type": "image_url", "image_url": {"url": "https://..."}}
  ],
  "duration": 5
}
```

创建请求体（文生视频）:
```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    {"type": "text", "text": "一只猫在草地上奔跑"}
  ],
  "duration": 5
}
```

查询响应体:
```json
{
  "id": "cgt-xxx",
  "model": "doubao-seedance-2-0-260128",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-...mp4?X-Tos-..."
  }
}
```

### Seed Audio 音频生成 API

- **端点**: 同样走 `contents/generations/tasks`
- **model**: `doubao-seed-audio-1-0`
- **输入**: 文本（含对白、情绪、BGM、音效描述）
- **输出**: `content.audio_url`

创建请求体:
```json
{
  "model": "doubao-seed-audio-1-0",
  "content": [
    {"type": "text", "text": "一位老人在海边讲述童年故事，远处传来海浪声"}
  ]
}
```

## 后端改动

### 1. ai_service.py — 新增 `call_video_gen` 和 `call_audio_gen`

#### `call_video_gen(db, model_id, prompt, image_url=None, params=None) -> dict`

```python
async def call_video_gen(db, model_id, prompt, image_url=None, params=None) -> dict:
    """视频生成：调用 Ark contents/generations/tasks API

    Args:
        model_id: AI Model UUID（model_type 应为 video_gen）
        prompt: 视频描述提示词
        image_url: 首帧图片 URL（图生视频时传入，文生视频时不传）
        params: 额外参数（duration, ratio, resolution）

    Returns:
        {"video_url": "minio://...", "remote_task_id": "cgt-xxx"}
    """
```

流程:
1. `_get_provider_and_model(db, model_id, expected_type="video_gen")` 校验
2. 构建 content 数组: text 必填 + image_url 可选
3. POST 创建任务，获取 `id`（remote_task_id）
4. 轮询 GET（间隔 5s，超时 300s），状态检查
5. 下载 video_url 到 MinIO（httpx 流式下载 + media_service 上传）
6. 返回 MinIO 内部路径

#### `call_audio_gen(db, model_id, text, params=None) -> dict`

```python
async def call_audio_gen(db, model_id, text, params=None) -> dict:
    """音频生成：调用 Ark contents/generations/tasks API

    Args:
        model_id: AI Model UUID（model_type 应为 tts）
        text: 文本内容（含对白、情绪、场景描述）
        params: 额外参数（voice 等）

    Returns:
        {"audio_url": "minio://...", "remote_task_id": "cgt-xxx"}
    """
```

流程同 `call_video_gen`，只是 model_type 校验为 `tts`，content 只含 text。

### 2. render_tasks.py — 替换模拟实现

#### `_do_img2video` 改造

```python
async def _do_img2video(task_id, model_id, prompt, input_artifacts, node_params):
    """图生视频：从上游获取图片 URL，调用 call_video_gen"""
    # 1. 从 input_artifacts 提取 image_url
    image_url = _extract_image_url_from_artifacts(input_artifacts)
    # 2. 也可从 node_params.url 读取
    if not image_url and node_params:
        image_url = node_params.get("url", "")

    # 3. 调用真实 API（有 model_id 时）或模拟
    if model_id:
        result = await call_video_gen(db, model_id, prompt, image_url, node_params)
        result_url = result["video_url"]
    else:
        # 回退模拟
        ...

    # 4. 更新 DB
    await _update_task(db, task_id, status="completed", progress=100, result_url=result_url)
```

#### 新增 `_do_text2video`

```python
async def _do_text2video(task_id, model_id, prompt, input_artifacts, node_params):
    """文生视频：仅文本输入，调用 call_video_gen(image_url=None)"""
    result = await call_video_gen(db, model_id, prompt, image_url=None, params=node_params)
    ...
```

#### `_do_tts` 改造

```python
async def _do_tts(task_id, model_id, prompt, node_params):
    """文生语音：调用 call_audio_gen"""
    if model_id:
        result = await call_audio_gen(db, model_id, text, node_params)
        result_url = result["audio_url"]
    else:
        # 回退模拟
        ...
```

#### `_execute_ai_task` 路由更新

```python
elif task_type == "ai_text2video":
    return await _do_text2video(task_id, model_id, user_content, input_artifacts, node_params)
```

#### 新增辅助函数

```python
def _extract_image_url_from_artifacts(artifacts: list[dict] | None) -> str:
    """从 input_artifacts 提取图片 URL"""
    if not artifacts:
        return ""
    for a in artifacts:
        if a.get("type") == "image" and a.get("url"):
            return a["url"]
    return ""
```

### 3. ai_service.py — 节点配置更新

```python
# NODE_WHITELIST 新增
"text_to_video": "ai_inference",

# NODE_DEFAULT_LABELS 新增
"text_to_video": "文生视频",

# NODE_DEFAULT_PARAMS 新增
"text_to_video": {"prompt": "", "duration": 5},

# AI_INFERENCE_MODEL_TYPE 新增
"text_to_video": "video_gen",
```

### 4. MinIO 持久化

Ark 返回的 video_url / audio_url 24h 过期，必须下载到 MinIO。

在 `call_video_gen` / `call_audio_gen` 中:
1. 获取临时 URL
2. httpx 流式下载到临时文件
3. 调用 `media_service.upload_file()` 上传到 MinIO + 写入 media_assets 表
4. 返回 `/api/v1/media/{asset_id}/download` 作为持久化 URL

注意: Celery 任务中需要创建自己的 db session（复用 `_get_celery_session_factory()`），并调用 `media_service` 完成上传。

## 前端改动

### 1. 类型定义 — canvas.ts

```typescript
// 新增子类型
export type AIInferenceSubtype = 'text_to_image' | 'image_to_video' | 'text_to_video' | 'text_to_speech';
```

### 2. 节点模板 — canvas.ts NODE_TEMPLATES

```typescript
// 新增文生视频节点
{ type: 'ai_inference', subtype: 'text_to_video', label: '文生视频',
  icon: 'Video', category: 'AI 推理',
  defaultParams: { prompt: '', duration: 5, model_id: '' } },

// image_to_video 补充 model_id
{ type: 'ai_inference', subtype: 'image_to_video', label: '图生视频',
  icon: 'Video', category: 'AI 推理',
  defaultParams: { prompt: '', duration: 5, model_id: '' } },

// text_to_speech 补充 model_id
{ type: 'ai_inference', subtype: 'text_to_speech', label: '文生语音',
  icon: 'Mic', category: 'AI 推理',
  defaultParams: { text: '', voice: 'default', model_id: '' } },
```

### 3. workflowExecutor.ts — 路由更新

`text_to_video` 节点的 task_type 映射为 `ai_text2video`。

### 4. Editor.tsx — 无需改动

AI 模型选择器已对所有 `ai_inference` 类型节点生效，动态读取 `model_type` 对应的模型列表。

## 数据库改动

无需新增迁移。`model_type` 字段已有 `video_gen` 和 `tts` 值支持，用户在 Settings 页面添加对应模型即可。

## 用户配置流程

1. Settings → AI 配置 → 添加 Provider（火山引擎 Ark，base_url = `https://ark.cn-beijing.volces.com/api/v3`）
2. 添加 Model:
   - `doubao-seedance-2-0-260128`（model_type=video_gen）
   - `doubao-seed-audio-1-0`（model_type=tts）
3. 画布中使用 `图生视频` / `文生视频` / `文生语音` 节点，选择对应模型
4. 执行工作流 → 触发真实 API 调用

## 错误处理

- **无模型 / 模型未配置**: 回退到模拟生成，result_url 标记为模拟
- **API 调用失败**: 标记任务 failed，error_message 包含 HTTP 状态码和错误详情
- **轮询超时**（300s）: 标记任务 failed，提示"视频生成超时"
- **MinIO 上传失败**: 标记任务 failed，提示"结果保存失败"
- **Ark 内容审核拒绝**: 标记任务 failed，提示"内容审核未通过"

## 回退策略

与 `_do_text2img` 一致：当 `model_id` 为空或模型类型不匹配时，回退到模拟生成，保证功能不中断。
