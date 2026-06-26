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
6. [通用错误码](#6-通用错误码)

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
  "email": "alice@example.com"
}
```

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

> 当前状态：后端 API 已实现，前端 MediaLibrary.tsx **仍使用 Mock 数据**，尚未对接

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

**前端字段映射（待对接）：**

| 后端字段 | 当前 Mock 字段 | 转换逻辑 |
|----------|---------------|----------|
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

> 当前开发模式：文件内容未持久化到 MinIO，仅存元数据到数据库

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

> 当前为占位实现，非真正的 S3 预签名

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
  -d '{"project_id":"c0e6f694-6ff3-4a85-97c4-9c6c9d8cf6ef","output_format":"mp4"}'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 项目 UUID |
| output_format | string | 否 | 输出格式（默认 mp4） |

**响应 200：**

```json
{
  "id": "f3d4e5f6-...",
  "project_id": "c0e6f694-...",
  "owner_id": "65e9619c-...",
  "task_type": "render",
  "status": "pending",
  "progress": 0.0,
  "celery_task_id": null,
  "result_url": null,
  "error_message": null,
  "created_at": "2026-06-26T13:00:00.000000",
  "updated_at": "2026-06-26T13:00:00.000000"
}
```

**status 枚举：** `pending` → `running` → `completed` / `failed` / `cancelled`

---

### GET /render/{task_id} — 获取渲染任务状态

```bash
curl http://localhost:8000/api/v1/render/<task_id> \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** 同上

---

### POST /render/{task_id}/cancel — 取消渲染任务

```bash
curl -X POST http://localhost:8000/api/v1/render/<task_id>/cancel \
  -H 'Authorization: Bearer <token>'
```

**响应 200：** 状态变为 `cancelled`

**错误：** 409 任务已完成，无法取消

---

## 6. 通用错误码

| HTTP 状态码 | 错误信息 | 说明 |
|-------------|----------|------|
| 400 | 无效的项目 ID 格式 | 路径参数不是合法 UUID |
| 401 | 未提供认证凭据 / 无效或过期的认证凭据 | Token 缺失或过期，前端应跳转登录页 |
| 404 | 项目不存在 / 节点不存在 / 边不存在 / 媒体资产不存在 / 渲染任务不存在 | 资源未找到或无权访问 |
| 409 | 任务已完成，无法取消 | 渲染任务状态不允许取消 |
| 500 | Internal Server Error | 服务端异常，查看后端日志 |

**统一错误响应格式：**

```json
{
  "detail": "错误信息描述"
}
```

---

## 前端 API 客户端速查

所有 API 调用已封装在 `frontend/src/utils/apiClient.ts`：

```typescript
import { authApi, projectApi, workflowApi, mediaApi, renderApi } from '@/utils/apiClient';

// 认证
authApi.register(username, email, password);
authApi.login(username, password);
authApi.getMe();

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
renderApi.create(projectId, taskType);
renderApi.get(taskId);
renderApi.cancel(taskId);
renderApi.poll(taskId, intervalMs?, onProgress?);      // 轮询直到完成
```

> `request()` 函数自动注入 `Authorization` Header、处理 401 跳转登录、解析错误响应。
