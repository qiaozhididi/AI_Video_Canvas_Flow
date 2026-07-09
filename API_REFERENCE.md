# AI Canvas Flow — 后端 API 接口文档

> Base URL: `/api/v1`  
> 认证方式: Bearer Token (JWT)  
> Content-Type: `application/json`（文件上传除外）

---

## 目录

1. [认证](#1-认证)
2. [项目](#2-项目)
3. [工作流（节点/边）](#3-工作流节点边)
4. [媒体资产](#4-媒体资产)
5. [渲染任务](#5-渲染任务)
6. [AI 配置（Provider/Model）](#6-ai-配置providermodel)
7. [快照](#7-快照)
8. [模板市场](#8-模板市场)
9. [通用错误码](#9-通用错误码)

---

## 1. 认证

### POST /auth/register — 注册新用户

**无需 Token**

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"MyPass123"}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名（唯一） |
| email | string | 是 | 邮箱（唯一） |
| password | string | 是 | 密码 |

**响应 200：**

```json
{
  "id": "65e9619c-6cba-4333-aa5d-397e726711f4",
  "username": "alice",
  "email": "alice@example.com"
}
```

**错误：** 400 用户名已存在 / 邮箱已被注册

---

### POST /auth/login — 用户登录

**无需 Token**

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"MyPass123"}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

**响应 200：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

> 后续所有请求需在 Header 中携带 `Authorization: Bearer <access_token>`

**错误：** 401 用户名或密码错误

---

### POST /auth/refresh — 刷新访问令牌

**无需 Token**（使用 refresh_token 认证）

```bash
curl -X POST http://localhost:8000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"eyJhbGciOiJIUzI1NiIs..."}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| refresh_token | string | 是 | 登录时返回的 refresh_token |

**响应 200：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

> 前端 `apiClient.ts` 在 401 时自动调用此端点续期，使用防并发锁避免多个请求同时刷新。

**错误：** 401 refresh token 已过期 / 无效的 refresh token

---

### GET /auth/me — 获取当前用户信息

```bash
curl http://localhost:8000/api/v1/auth/me \
  -H 'Authorization: Bearer <token>'
```

**响应 200：**

```json
{
  "id": "65e9619c-6cba-4333-aa5d-397e726711f4",
  "username": "alice",
  "email": "alice@example.com",
  "avatar_url": null
}
```

---

### PUT /auth/me — 更新当前用户资料

```bash
curl -X PUT http://localhost:8000/api/v1/auth/me \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_new","email":"alice_new@example.com","avatar_url":"https://..."}'
```

**请求体：** 仅传需要更新的字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 否 | 新用户名（唯一性校验） |
| email | string | 否 | 新邮箱（唯一性校验） |
| avatar_url | string \| null | 否 | 头像 URL |

**响应 200：** 更新后的用户对象（同 GET /auth/me）

**错误：** 400 用户名已存在 / 邮箱已被注册

---

## 2. 项目

### GET /projects/ — 获取项目列表

```bash
curl http://localhost:8000/api/v1/projects/ \
  -H 'Authorization: Bearer <token>'
```

**响应 200：**

```json
[
  {
    "id": "c0e6f694-6ff3-4a85-97c4-9c6c9d8cf6ef",
    "name": "E2E测试项目",
    "description": null,
    "cover_url": null,
    "owner_id": "65e9619c-6cba-4333-aa5d-397e726711f4",
    "created_at": "2026-06-26T12:59:42.324076",
    "updated_at": "2026-06-26T13:00:10.712345"
  }
]
```

---

### POST /projects/ — 创建新项目

```bash
curl -X POST http://localhost:8000/api/v1/projects/ \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"我的项目","description":"项目描述"}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 项目名称 |
| description | string | 否 | 项目描述 |

**响应 200：** 同项目列表中的单个对象

---

### GET /projects/{project_id} — 获取项目详情

```bash
curl http://localhost:8000/api/v1/projects/<project_id> \
  -H 'Authorization: Bearer <token>'
```

**路径参数：** `project_id` (UUID 字符串)

**响应 200：** 同上

**错误：** 404 项目不存在

---

### PUT /projects/{project_id} — 更新项目

```bash
curl -X PUT http://localhost:8000/api/v1/projects/<project_id> \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"新名称","description":"新描述"}'
```

**请求体：** 仅传需要更新的字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 否 | 新名称 |
| description | string | 否 | 新描述 |

> 传空对象 `{}` 可触发 `updated_at` 刷新

**响应 200：** 更新后的项目对象

---

### DELETE /projects/{project_id} — 删除项目

```bash
curl -X DELETE http://localhost:8000/api/v1/projects/<project_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 204：** 无内容

> 级联删除关联的渲染任务和媒体资产

---

### POST /projects/{project_id}/cover — 上传项目封面

```bash
curl -X POST http://localhost:8000/api/v1/projects/<project_id>/cover \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"data_url":"data:image/png;base64,..."}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| data_url | string | 是 | Canvas 截图的 data URL（Base64） |

**逻辑：** 解码 data URL → 上传至 MinIO 路径 `covers/{project_id}.png`（覆盖旧文件） → 更新 `project.cover_url`，不创建 MediaAsset 记录

**响应 200：** 更新后的项目对象

---

### GET /projects/{project_id}/cover/download — 下载项目封面

```bash
curl http://localhost:8000/api/v1/projects/<project_id>/cover/download \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** 图片文件流（Content-Type: image/png）

**错误：** 404 封面不存在

---

## 3. 工作流（节点/边）

所有工作流端点的路径参数 `workflow_id` 等同于 `project_id`（UUID 字符串）。

### GET /workflows/{workflow_id}/nodes — 获取工作流节点

```bash
curl http://localhost:8000/api/v1/workflows/<project_id>/nodes \
  -H 'Authorization: Bearer <token>'
```

**响应 200：**

```json
[
  {
    "id": "node-1782476890770-n9ckd6",
    "project_id": "c0e6f694-6ff3-4a85-97c4-9c6c9d8cf6ef",
    "node_type": "input",
    "label": "文本输入",
    "position_x": 100.0,
    "position_y": 200.0,
    "config": {
      "type": "input",
      "subtype": "text_input",
      "label": "文本输入",
      "params": {},
      "status": "idle",
      "progress": 0,
      "outputArtifacts": []
    },
    "created_at": "2026-06-26T12:59:42.324076",
    "updated_at": "2026-06-26T12:59:42.324078"
  }
]
```

> `config` 字段存储前端 `CanvasNodeData` 的完整 JSON，包含 type/subtype/label/params/status/progress/outputArtifacts/error

---

### POST /workflows/{workflow_id}/nodes — 创建节点

```bash
curl -X POST http://localhost:8000/api/v1/workflows/<project_id>/nodes \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "node-1782476890770-n9ckd6",
    "node_type": "input",
    "label": "文本输入",
    "position_x": 100,
    "position_y": 200,
    "config": {"type":"input","subtype":"text_input","label":"文本输入","params":{},"status":"idle","progress":0,"outputArtifacts":[]}
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 前端生成的节点 ID（如 `node-1782476890770-n9ckd6`） |
| node_type | string | 是 | 节点类型：input / ai_inference / processing / control / output |
| label | string | 否 | 节点标签 |
| position_x | float | 否 | X 坐标（默认 0） |
| position_y | float | 否 | Y 坐标（默认 0） |
| config | object | 否 | 完整节点数据 JSON |

**响应 200：** 创建的节点对象

---

### DELETE /workflows/{workflow_id}/nodes/{node_id} — 删除节点

```bash
curl -X DELETE http://localhost:8000/api/v1/workflows/<project_id>/nodes/<node_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 204：** 无内容

> 同时删除关联该节点的所有边

---

### GET /workflows/{workflow_id}/edges — 获取工作流边

```bash
curl http://localhost:8000/api/v1/workflows/<project_id>/edges \
  -H 'Authorization: Bearer <token>'
```

**响应 200：**

```json
[
  {
    "id": "edge-1782476890800-a1b2c3",
    "project_id": "c0e6f694-6ff3-4a85-97c4-9c6c9d8cf6ef",
    "source_node_id": "node-1782476890770-n9ckd6",
    "target_node_id": "node-1782476890780-x7y8z9",
    "source_port": "output",
    "target_port": "input",
    "created_at": "2026-06-26T12:59:42.899272",
    "updated_at": "2026-06-26T12:59:42.899274"
  }
]
```

---

### POST /workflows/{workflow_id}/edges — 创建边

```bash
curl -X POST http://localhost:8000/api/v1/workflows/<project_id>/edges \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "edge-1782476890800-a1b2c3",
    "source_node_id": "node-1782476890770-n9ckd6",
    "target_node_id": "node-1782476890780-x7y8z9",
    "source_port": "output",
    "target_port": "input"
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 前端生成的边 ID |
| source_node_id | string | 是 | 源节点 ID |
| target_node_id | string | 是 | 目标节点 ID |
| source_port | string | 否 | 源端口 Handle ID |
| target_port | string | 否 | 目标端口 Handle ID |

**响应 200：** 创建的边对象

---

### DELETE /workflows/{workflow_id}/edges/{edge_id} — 删除边

```bash
curl -X DELETE http://localhost:8000/api/v1/workflows/<project_id>/edges/<edge_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 204：** 无内容

---

### PUT /workflows/{workflow_id}/save — 批量保存工作流

> 替换式保存：删除项目下全部节点和边，然后插入新数据。前端"保存"按钮调用此端点。

```bash
curl -X PUT http://localhost:8000/api/v1/workflows/<project_id>/save \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "nodes": [
      {
        "id": "node-001",
        "node_type": "input",
        "label": "文本输入",
        "position_x": 100,
        "position_y": 200,
        "config": {"type":"input","subtype":"text_input"}
      },
      {
        "id": "node-002",
        "node_type": "ai_inference",
        "label": "AI推理",
        "position_x": 400,
        "position_y": 200,
        "config": {"type":"ai_inference"}
      }
    ],
    "edges": [
      {
        "id": "edge-001",
        "source_node_id": "node-001",
        "target_node_id": "node-002"
      }
    ]
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| nodes | NodeCreate[] | 是 | 节点数组（可为空） |
| edges | EdgeCreate[] | 是 | 边数组（可为空） |

> NodeCreate 和 EdgeCreate 的字段同单个创建端点

**响应 200：**

```json
{
  "nodes_count": 2,
  "edges_count": 1
}
```

---

### 前端加载工作流（组合调用）

前端 `workflowApi.loadWorkflow()` 同时请求节点和边：

```bash
# 并行请求
curl http://localhost:8000/api/v1/workflows/<project_id>/nodes \
  -H 'Authorization: Bearer <token>' &

curl http://localhost:8000/api/v1/workflows/<project_id>/edges \
  -H 'Authorization: Bearer <token>'
```

**前端转换映射（projectStore.ts）：**

| 后端字段 | 前端字段 | 说明 |
|----------|----------|------|
| id | id | 字符串 ID 直传 |
| node_type | type | React Flow 节点类型 |
| position_x, position_y | position.x, position.y | 坐标 |
| config | data | 整体映射为 CanvasNodeData |
| config.type | data.type | 节点分类 |
| config.subtype | data.subtype | 子类型 |
| config.label | data.label | 显示名称 |
| source_node_id | source | React Flow 边源 |
| target_node_id | target | React Flow 边目标 |
| source_port | sourceHandle | React Flow Handle |
| target_port | targetHandle | React Flow Handle |

---

## 4. 媒体资产

> 前端 MediaLibrary.tsx 已对接后端 API，支持 MinIO 上传/下载/缩略图懒加载/分页/拖拽上传

### GET /media/ — 获取媒体资产列表

```bash
curl http://localhost:8000/api/v1/media/ \
  -H 'Authorization: Bearer <token>'
```

**响应 200：**

```json
[
  {
    "id": "a1b2c3d4-...",
    "owner_id": "65e9619c-...",
    "project_id": null,
    "file_name": "scene_01.png",
    "file_type": "image/png",
    "file_size": 2516582,
    "storage_key": "media/65e9619c-.../a1b2c3d4-.../scene_01.png",
    "thumbnail_key": null,
    "created_at": "2026-06-26T12:59:42.324076",
    "updated_at": "2026-06-26T12:59:42.324078"
  }
]
```

**前端字段映射：**

| 后端字段 | 前端字段 | 转换逻辑 |
|----------|----------|----------|
| file_name | name | 直接使用 |
| file_type | type | `file_type.split('/')[0]` → image/video/audio |
| file_size | size | `(file_size / 1024 / 1024).toFixed(1) + ' MB'` |
| created_at | date | `new Date(created_at).toLocaleDateString('zh-CN')` |

---

### POST /media/upload — 上传媒体文件

```bash
curl -X POST http://localhost:8000/api/v1/media/upload \
  -H 'Authorization: Bearer <token>' \
  -F 'file=@/path/to/image.png'
```

**请求：** `multipart/form-data`，字段名 `file`

**响应 200：** 同资产列表中的单个对象

> 文件通过 MinIO SDK 持久化到 MinIO 对象存储，元数据存入数据库

---

### GET /media/{asset_id} — 获取资产详情

```bash
curl http://localhost:8000/api/v1/media/<asset_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** 同上

---

### GET /media/{asset_id}/presign — 获取预签名下载 URL

```bash
curl http://localhost:8000/api/v1/media/<asset_id>/presign \
  -H 'Authorization: Bearer <token>'
```

**响应 200：**

```json
{
  "url": "http://localhost:9000/ai-canvas-flow/media/65e9619c/.../scene_01.png",
  "expires_in": 3600
}
```

> 使用 MinIO SDK 真正的 S3 预签名 URL（默认 1 小时有效期）

---

### DELETE /media/{asset_id} — 删除媒体资产

```bash
curl -X DELETE http://localhost:8000/api/v1/media/<asset_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 204：** 无内容

---

## 5. 渲染任务

### POST /render/ — 创建渲染任务

```bash
curl -X POST http://localhost:8000/api/v1/render/ \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id":"c0e6f694-6ff3-4a85-97c4-9c6c9d8cf6ef",
    "task_type":"ai_text2img",
    "node_id":"node-1782476890770-n9ckd6",
    "model_id":"uuid-of-ai-model",
    "prompt":"一只在月光下的猫",
    "input_artifacts":[{"type":"text","url":"asset://upstream-text"}]
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 项目 UUID |
| task_type | string | 否 | 任务类型（默认 `render`）；`ai_*` 前缀走 AI 推理，其他走模拟渲染 |
| node_id | string | 否 | 关联的画布节点 ID（用于画布节点触发渲染） |
| model_id | string | 否 | AI Model UUID（AI 推理任务必填） |
| prompt | string | 否 | 用户提示词（AI 推理任务） |
| input_artifacts | object[] | 否 | 上游节点输出资产 `[{type, url, text?, filename?}]` |
| output_format | string | 否 | 输出格式（默认 mp4） |

**task_type 路由：**
- `ai_text2img` / `ai_img2img` → 调 `call_image_gen` / `call_img2img`（Images API）
- `ai_img2video` / `ai_text2video` → 调 `call_video_gen`（Ark 异步 API + 轮询）
- `ai_tts` → 调 `call_audio_gen`（Ark 异步 API + 轮询）
- 非 `ai_` 前缀 → 模拟渲染进度

**响应 200：**

```json
{
  "id": "f3d4e5f6-...",
  "project_id": "c0e6f694-...",
  "owner_id": "65e9619c-...",
  "task_type": "ai_text2img",
  "status": "pending",
  "progress": 0,
  "celery_task_id": null,
  "result_url": null,
  "error_message": null,
  "node_id": "node-1782476890770-n9ckd6",
  "created_at": "2026-06-26T13:00:00.000000",
  "updated_at": "2026-06-26T13:00:00.000000"
}
```

> `progress` 为 0-100 整数（非 0.0-1.0 小数）

**status 枚举：** `pending` → `running` → `completed` / `failed` / `cancelled`

---

### GET /render/{task_id} — 获取渲染任务状态

```bash
curl http://localhost:8000/api/v1/render/<task_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** 同上

---

### POST /render/{task_id}/retry — 重试渲染任务

```bash
curl -X POST http://localhost:8000/api/v1/render/<task_id>/retry \
  -H 'Authorization: Bearer <token>'
```

**逻辑：** 复制原任务参数 + 从关联节点读取最新 `node_params`，创建新任务并触发 Celery 执行。

**响应 200：** 新的 `RenderTaskResponse`（状态为 `pending`）

**错误：** 404 任务不存在

---

### POST /render/{task_id}/cancel — 取消渲染任务

```bash
curl -X POST http://localhost:8000/api/v1/render/<task_id>/cancel \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** 状态变为 `cancelled`

**错误：** 409 任务已完成，无法取消

---

## 6. AI 配置（Provider/Model）

> AI Provider/Model 可配置系统，支持多平台、多模型、多 Key。首次启动自动创建默认火山引擎 Provider + 豆包模型。

### POST /ai/providers — 创建 AI Provider

```bash
curl -X POST http://localhost:8000/api/v1/ai/providers \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"火山引擎","platform":"volcengine","base_url":"https://ark.cn-beijing.volces.com/api/v3","api_key":"ark-xxx","is_active":true}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 显示名称 |
| platform | string | 是 | 平台标识（volcengine/openai/custom） |
| base_url | string | 是 | API 端点 |
| api_key | string | 是 | API Key |
| is_active | boolean | 否 | 是否启用（默认 true） |

**响应 200：** Provider 对象（含 id/created_at/updated_at）

---

### GET /ai/providers — 列出所有 Provider

```bash
curl http://localhost:8000/api/v1/ai/providers \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** Provider 对象数组

---

### PUT /ai/providers/{provider_id} — 更新 Provider

**请求体：** 同创建，所有字段可选

---

### DELETE /ai/providers/{provider_id} — 删除 Provider

**响应 204：** 无内容

---

### POST /ai/models — 创建 AI Model

```bash
curl -X POST http://localhost:8000/api/v1/ai/models \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"provider_id":"uuid","model_id":"doubao-seed-2-1-turbo-260628","display_name":"豆包 Seed 2.1 Turbo","model_type":"llm","is_active":true}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| provider_id | string | 是 | 关联的 Provider UUID |
| model_id | string | 是 | 平台模型标识 |
| display_name | string | 是 | 前端显示名 |
| model_type | string | 是 | 模型类型（llm/image_gen/video_gen/tts） |
| is_active | boolean | 否 | 是否启用（默认 true） |

---

### GET /ai/models — 列出所有 Model

```bash
curl 'http://localhost:8000/api/v1/ai/models?provider_id=<uuid>' \
  -H 'Authorization: Bearer <token>'
```

**查询参数：** `provider_id`（可选，按 Provider 筛选）

---

### GET /ai/models/default — 获取默认 AI 模型

```bash
curl http://localhost:8000/api/v1/ai/models/default \
  -H 'Authorization: Bearer <token>'
```

**逻辑：** 返回当前用户第一个 active 的 AI Model（关联的 Provider 也必须 active）

**响应 200：** Model 对象

**错误：** 404 未找到可用的 AI 模型，请先在设置页配置

---

### POST /ai/generate-workflow — AI 快速生成工作流

```bash
curl -X POST http://localhost:8000/api/v1/ai/generate-workflow \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"description":"生成一段关于猫咪的视频工作流","mode":"replace","model_id":"uuid-of-llm-model"}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| description | string | 是 | 自然语言工作流描述 |
| mode | `"replace"` \| `"append"` | 否 | 替换现有画布或追加（默认 `replace`） |
| model_id | string | 否 | 指定 LLM 模型 UUID（不传则用默认 LLM） |

**逻辑：** LLM 解析描述 → 生成节点/边 JSON → 自动网格布局 → 返回 WorkflowSaveRequest 格式

**响应 200：** `WorkflowSaveRequest`（`{nodes: NodeCreateRequest[], edges: EdgeCreateRequest[]}`）

**错误：** 404 未找到可用的 LLM 模型 / 500 AI 生成失败

---

### PUT /ai/models/{model_id} — 更新 Model

**请求体：** 同创建，所有字段可选

---

### DELETE /ai/models/{model_id} — 删除 Model

**响应 204：** 无内容

---

## 7. 快照

> 用于编辑器自动保存与崩溃恢复。快照仅追加到 `project_snapshots` 表，不修改实际 nodes/edges；恢复时通过 `POST /snapshots/{id}/restore` 单事务替换。
>
> **5 auto 上限策略**：`source='auto'` 的快照受 5 条上限约束（插入前清理最旧），`source='manual'` 快照不计数。

### POST /projects/{project_id}/snapshots — 创建快照

```bash
curl -X POST http://localhost:8000/api/v1/projects/<project_id>/snapshots \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "source":"auto",
    "snapshot_data":{
      "nodes":[{"id":"n1","node_type":"input","label":"文本","position_x":100,"position_y":200,"config":{"type":"input"}}],
      "edges":[],
      "timelineData":{"duration":30,"tracks":[],"currentTime":0,"zoom":1}
    }
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source | `"auto"` \| `"manual"` | 是 | 快照来源；`auto` 受 5 条上限约束 |
| label | string \| null | 否 | 命名快照标签（`manual` 常用） |
| snapshot_data | object | 是 | `{nodes, edges, timelineData}` 结构，存为 JSONB |

**响应 200：**

```json
{
  "id": "snapshot-uuid",
  "project_id": "project-uuid",
  "owner_id": "user-uuid",
  "source": "auto",
  "label": null,
  "snapshot_data": { "nodes": [], "edges": [], "timelineData": {} },
  "created_at": "2026-06-27T12:00:00"
}
```

**错误：** 404 项目不存在 / 400 无效的项目 ID 格式

---

### GET /projects/{project_id}/snapshots — 获取快照列表

```bash
curl "http://localhost:8000/api/v1/projects/<project_id>/snapshots?source=auto" \
  -H "Authorization: Bearer $TOKEN"
```

**查询参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source | `"auto"` \| `"manual"` | 否 | 按 source 筛选；不传则返回全部 |

**响应 200：** `SnapshotResponse[]`，按 `created_at DESC` 排序

---

### GET /projects/{project_id}/snapshots/latest — 获取最新快照

```bash
curl http://localhost:8000/api/v1/projects/<project_id>/snapshots/latest \
  -H "Authorization: Bearer $TOKEN"
```

**响应 200：** `SnapshotResponse`（不限 source 的最新一条）

**错误：** 404 无快照 / 404 项目不存在

> 前端 `autoSaveStore.checkRecovery()` 用此端点检测崩溃恢复：对比 `created_at` 与 `project.updatedAt`，若快照更新则提示恢复。

---

### GET /snapshots/{snapshot_id} — 获取快照详情

```bash
curl http://localhost:8000/api/v1/snapshots/<snapshot_id> \
  -H "Authorization: Bearer $TOKEN"
```

**响应 200：** `SnapshotResponse`

**错误：** 404 快照不存在 / 400 无效的快照 ID 格式

---

### DELETE /snapshots/{snapshot_id} — 删除快照

```bash
curl -X DELETE http://localhost:8000/api/v1/snapshots/<snapshot_id> \
  -H "Authorization: Bearer $TOKEN"
```

**响应 204：** 无内容

**错误：** 404 快照不存在

---

### POST /snapshots/{snapshot_id}/restore — 恢复快照

> 单事务恢复：删除项目现有 nodes/edges → 从 `snapshot_data` 插入新 nodes/edges → 刷新 `project.updated_at` → commit。
>
> 字段映射兼容性：同时支持前端格式（`source`/`target`/`sourceHandle`/`targetHandle`/`position.x`/`data`）和后端格式（`source_node_id`/`target_node_id`/`source_port`/`target_port`/`position_x`/`config`）。

```bash
curl -X POST http://localhost:8000/api/v1/snapshots/<snapshot_id>/restore \
  -H "Authorization: Bearer $TOKEN"
```

**响应 200：**

```json
{
  "restored": true,
  "project_id": "project-uuid",
  "nodes_count": 3,
  "edges_count": 2
}
```

**错误：** 404 快照不存在 / 400 无效的快照 ID 格式

---

## 8. 模板市场

> 模板复用 projects 表（`is_template` 标记），支持列表搜索/分类筛选/克隆为新项目/发布项目为模板。克隆时复制 nodes/edges，新节点 ID 加项目前缀避免冲突。

### GET /templates/ — 获取模板列表

```bash
curl 'http://localhost:8000/api/v1/templates/?q=视频&category=marketing' \
  -H 'Authorization: Bearer <token>'
```

**查询参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 否 | 搜索关键词（匹配 name 模糊 OR tags 包含） |
| category | string | 否 | 按分类筛选 |

**响应 200：** `TemplateResponse[]`，按 `created_at DESC` 排序

```json
[
  {
    "id": "c0e6f694-...",
    "name": "产品宣传视频模板",
    "description": "...",
    "cover_url": null,
    "owner_id": "65e9619c-...",
    "created_at": "2026-06-27T12:00:00",
    "updated_at": "2026-06-27T12:00:00",
    "is_template": true,
    "template_category": "marketing",
    "template_tags": ["产品", "宣传"]
  }
]
```

---

### POST /templates/{template_id}/clone — 克隆模板为新项目

```bash
curl -X POST http://localhost:8000/api/v1/templates/<template_id>/clone \
  -H 'Authorization: Bearer <token>'
```

**路径参数：** `template_id` (UUID 字符串)

**逻辑：** 创建新项目 → 复制模板的 nodes/edges（新节点 ID 加项目前缀 `{new_project_id前8位}_{原node_id}`）→ commit

**响应 200：** 新项目对象（`ProjectResponse`，`is_template=false`，名称为 `{原模板名} 副本`）

**错误：** 404 模板不存在

---

### POST /projects/{project_id}/publish — 发布项目为模板

```bash
curl -X POST http://localhost:8000/api/v1/projects/<project_id>/publish \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"category":"marketing","tags":["产品","宣传"]}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 是 | 模板分类 |
| tags | string[] | 是 | 模板标签数组 |

**逻辑：** 校验 owner → 设置 `is_template=true` + category + tags

**响应 200：** `TemplateResponse`

**错误：** 404 项目不存在或无权访问

---

### DELETE /templates/{template_id} — 取消模板发布

```bash
curl -X DELETE http://localhost:8000/api/v1/templates/<template_id> \
  -H 'Authorization: Bearer <token>'
```

**逻辑：** 校验 owner → 设置 `is_template=false` + 清空 category/tags

**响应 204：** 无内容

**错误：** 404 模板不存在或无权访问

---

## 9. 通用错误码

| HTTP 状态码 | 错误信息 | 说明 |
|-------------|----------|------|
| 400 | 无效的项目 ID 格式 | 路径参数不是合法 UUID |
| 401 | 未提供认证凭据 / 无效或过期的认证凭据 / 用户名或密码错误 | Token 缺失/过期时前端跳转登录页；登录接口返回 401 时不触发 token 刷新，直接展示错误 |
| 404 | 项目不存在 / 节点不存在 / 边不存在 / 媒体资产不存在 / 渲染任务不存在 / AI 服务商不存在 / AI 模型不存在 / 未找到可用的 AI 模型 / 快照不存在 / 无快照 | 资源未找到或无权访问 |
| 409 | 任务已完成，无法取消 / 不能接受自己的邀请 | 渲染任务状态不允许取消 / 用户尝试接受自己的项目邀请 |
| 502 | AI 服务调用失败，请检查配置或稍后重试 / AI 服务暂时不可用，请稍后重试 | AI 外部服务异常，不暴露内部错误详情 |
| 500 | Internal Server Error | 服务端异常，查看后端日志 |

**统一错误响应格式：**

```json
{
  "detail": "错误信息描述"
}
```

**前端错误处理策略：**

所有 API 错误经 `getErrorMessage(err, scene?)` 统一处理，优先展示后端 `detail`（中文），无中文时按场景/状态码 fallback。详见前端技术文档 §9.5。

---

## 前端 API 客户端速查

所有 API 调用已封装在 `frontend/src/utils/apiClient.ts`：

```typescript
import { authApi, projectApi, workflowApi, mediaApi, renderApi, aiApi, snapshotApi, templateApi } from '@/utils/apiClient';

// 认证
authApi.register(username, email, password);
authApi.login(username, password);
authApi.getMe();
authApi.update({ username?, email?, avatar_url? });   // 更新当前用户资料

// 项目
projectApi.list();
projectApi.create(name, description?);
projectApi.get(id);
projectApi.update(id, data);
projectApi.delete(id);

// 工作流
workflowApi.listNodes(projectId);
workflowApi.createNode(projectId, data);
workflowApi.deleteNode(projectId, nodeId);
workflowApi.listEdges(projectId);
workflowApi.createEdge(projectId, data);
workflowApi.deleteEdge(projectId, edgeId);
workflowApi.save(projectId, { nodes, edges });        // 批量保存
workflowApi.loadWorkflow(projectId);                   // 并行加载节点+边

// 媒体资产
mediaApi.list();
mediaApi.upload(file);                                  // FormData
mediaApi.getPresignedUrl(assetId);
mediaApi.delete(assetId);

// 渲染任务
renderApi.create({ project_id, task_type, node_id?, model_id?, prompt?, input_artifacts? });
renderApi.get(taskId);
renderApi.cancel(taskId);
renderApi.poll(taskId, intervalMs?, onProgress?);      // 轮询直到完成
renderApi.retry(taskId);                                 // 重试失败/取消的任务

// AI 配置
aiApi.providers.create(data);
aiApi.providers.list();
aiApi.providers.update(id, data);
aiApi.providers.delete(id);
aiApi.models.create(data);
aiApi.models.list(providerId?);
aiApi.models.update(id, data);
aiApi.models.delete(id);
aiApi.models.getDefault(modelType?);                   // 获取默认 AI 模型（可按类型筛选）
aiApi.generateWorkflow({ description, mode, model_id? }); // AI 快速生成工作流

// 快照（自动保存/崩溃恢复）
snapshotApi.create(projectId, { source, label?, snapshot_data });  // 创建快照
snapshotApi.list(projectId, source?);                              // 快照列表（可选 source 筛选）
snapshotApi.getLatest(projectId);                                  // 最新快照（崩溃恢复检测）
snapshotApi.get(snapshotId);                                       // 快照详情
snapshotApi.delete(snapshotId);                                    // 删除快照
snapshotApi.restore(snapshotId);                                   // 单事务恢复到 nodes/edges

// 模板市场
templateApi.list({ q?, category? });                    // 模板列表（搜索 + 分类筛选）
templateApi.clone(templateId);                          // 克隆模板为新项目
templateApi.publish(projectId, { category, tags });     // 发布项目为模板
templateApi.unpublish(templateId);                      // 取消模板发布
```

> `request()` 函数自动注入 `Authorization` Header、处理 401 拦截与 Token 刷新（`/auth/` 路径的 401 除外）、解析错误响应。错误提示统一经 `getErrorMessage()` 处理。
