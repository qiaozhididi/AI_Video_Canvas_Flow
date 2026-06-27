# AI Canvas Flow — 开发路线图与未完成功能清单

> 更新时间: 2026-06-27

## 当前项目状态概览

| 层级 | 模块 | 状态 | 说明 |
|------|------|------|------|
| 前端 | 画布编辑器 | ✅ 完成 | 节点拖放、连线、属性编辑、撤销重做 |
| 前端 | 媒体库 | ✅ 完成 | MinIO 上传/下载/缩略图懒加载/分页/拖拽上传 |
| 前端 | 渲染中心 | ❌ Stub | 全量 MOCK 数据，renderApi 未调用 |
| 前端 | 模板市场 | ❌ Stub | 全量 MOCK 数据，后端无模板 API |
| 前端 | 设置页 | ❌ Stub | 保存无持久化 |
| 前端 | 时间轴 | ⚠️ 部分 | 无播放驱动循环 |
| 前端 | 视频预览 | ⚠️ 部分 | 无视频源传入 |
| 前端 | 执行工作流 | ❌ Stub | 按钮无逻辑 |
| 后端 | 认证 API | ✅ 完成 | 注册/登录/JWT |
| 后端 | 项目 CRUD | ✅ 完成 | 级联删除 |
| 后端 | 工作流 CRUD | ✅ 完成 | 7 端点全对接数据库 |
| 后端 | 媒体资产 | ✅ 完成 | MinIO 上传/presign/下载/删除 |
| 后端 | 渲染任务 | ⚠️ 部分 | 写库但未触发 Celery 任务 |
| 后端 | WebSocket | ⚠️ 部分 | 广播可用，缺鉴权/持久化 |
| 后端 | Celery 任务 | ❌ 骨架 | 仅模拟进度 |

---

## 整体进度

| 层面 | 完成度 | 说明 |
|------|--------|------|
| 后端 API | **90%** | 24/25 端点已实现，仅 collaboration 为桩代码；render 模块写库但未触发 Celery |
| 前端 API 客户端 | **100%** | 所有后端端点均有对应前端方法（23 个） |
| 前端 Store 对接 | **33%** | 仅 authStore 和 projectStore 对接后端 |
| 前端页面对接 | **43%** | Login/Home 已对接；MediaLibrary 有 Mock 降级；Editor 半对接；其余纯 Mock |

---

## ✅ 已完成任务（P0 全部完成）

### 1. 工作流节点/边 CRUD 对接数据库
- **后端**: 7 个端点全实现（GET/POST/DELETE nodes + GET/POST/DELETE edges + PUT save）
- **前端**: projectStore 改用 projectApi/workflowApi
- **修复**: project_id 外键类型不匹配、workflow_id 未转 UUID、先删边再删节点

### 2. 项目保存/加载对接后端 API
- **前端**: projectStore 调用 projectApi.update()，不再使用 localStorage
- **前端**: 编辑器从 projectApi.get() 加载项目

### 3. 媒体库 — 上传/列表/删除/下载
- **前端**: MediaLibrary.tsx 调用 mediaApi，支持缩略图懒加载/降级占位/分页/拖拽/直接下载
- **后端**: MinIO 上传/presign/代理下载/删除
- **Mock**: 抽取至 `frontend/src/mock/`，`npm run dev:mock` 启动
- **涉及文件**: MediaLibrary.tsx, mock/mediaMock.ts, mock/canvasMock.ts, mock/index.ts, media.py, media_service.py

---

## 下一阶段开发计划

### 阶段一：渲染中心前后端打通（P1 优先级最高）

> 渲染任务是核心业务流程，当前前端纯 Mock、后端未触发 Celery，需要优先打通

#### 4.1 渲染中心前端对接
- **前端**: RenderCenter.tsx 替换 MOCK_TASKS 为 renderApi 调用
- **功能**: 提交渲染任务、查看任务列表、轮询进度、取消任务、下载结果
- **涉及文件**:
  - `frontend/src/pages/RenderCenter.tsx`
  - `frontend/src/utils/apiClient.ts`（renderApi 已定义，需在页面中使用）

#### 4.2 后端渲染任务触发 Celery
- **后端**: render.py 创建任务时调用 `run_render_task.delay(task_id)`
- **后端**: render_tasks.py 实现 Celery 任务真实逻辑（调用 AI 推理 API）
- **后端**: cancel 端点撤销 Celery 任务
- **涉及文件**:
  - `backend/app/api/render.py`
  - `backend/app/tasks/render_tasks.py`
  - `backend/app/tasks/ai_tasks.py`

---

### 阶段二：编辑器自动保存优化（P1）

> 编辑器当前依赖手动保存，需要优化为自动保存 + 崩溃恢复

#### 5.1 自动保存对接后端
- **前端**: autoSaveStore 从 localStorage 切换到后端 API
- **前端**: 双防抖策略（2s 操作防抖 + 30s 定时保存）+ 5 快照上限
- **涉及文件**:
  - `frontend/src/stores/autoSaveStore.ts`
  - `frontend/src/stores/projectStore.ts`

---

### 阶段三：设置页 + 模板市场（P2）

#### 6. 设置页持久化
- **后端**: auth.py 扩展 `PUT /me` 端点
- **前端**: Settings.tsx 调用 authApi.getMe + userApi.update
- **涉及文件**:
  - `frontend/src/pages/Settings.tsx`
  - `backend/app/api/auth.py`

#### 7. 模板市场
- **后端**: 新增模板 CRUD API（projects 表 + is_template 标记）
- **前端**: Templates.tsx 对接后端
- **涉及文件**:
  - `frontend/src/pages/Templates.tsx`
  - `backend/app/api/templates.py`（需新建）

---

### 阶段四：执行工作流 + WebSocket 协作（P2）

#### 8. 执行工作流按钮
- **前端**: 拓扑排序 + 逐节点提交渲染任务
- **前端**: 进度实时更新（WebSocket 或轮询）
- **涉及文件**:
  - `frontend/src/components/EditorLayout.tsx`
  - `frontend/src/utils/workflowExecutor.ts`（需新建）

#### 9. WebSocket 实时协作完善
- **后端**: Socket.IO 连接验证 JWT
- **后端**: node_update/edge_update 事件写入数据库
- **前端**: WebSocket 客户端 + 远端光标渲染
- **涉及文件**:
  - `backend/app/ws/collaboration.py`
  - `frontend/src/stores/collabStore.ts`（需新建）

---

### 阶段五：增强体验（P3）

#### 10. 时间轴播放驱动
- requestAnimationFrame 播放循环
- 片段 resize 拖拽 UI

#### 11. 视频预览联动
- 播放器与时间轴同步
- 执行工作流后输出视频传入 VideoPreview

#### 12. AI 快速生成
- 输入描述 → LLM API → 生成工作流节点/边

#### 13. 节点快捷操作
- 复制/粘贴、全选/框选、对齐工具

---

## 后端 API 完整清单

| 端点 | 方法 | 状态 | 备注 |
|------|------|------|------|
| `/api/v1/auth/register` | POST | ✅ | — |
| `/api/v1/auth/login` | POST | ✅ | — |
| `/api/v1/auth/me` | GET | ✅ | — |
| `/api/v1/projects/` | GET | ✅ | — |
| `/api/v1/projects/` | POST | ✅ | — |
| `/api/v1/projects/{id}` | GET | ✅ | — |
| `/api/v1/projects/{id}` | PUT | ✅ | — |
| `/api/v1/projects/{id}` | DELETE | ✅ | 级联删除 |
| `/api/v1/workflows/{id}/nodes` | GET | ✅ | 查询 workflow_nodes |
| `/api/v1/workflows/{id}/nodes` | POST | ✅ | 创建节点 |
| `/api/v1/workflows/{id}/nodes/{nid}` | DELETE | ✅ | 删除节点 + 关联边 |
| `/api/v1/workflows/{id}/edges` | GET | ✅ | 查询 workflow_edges |
| `/api/v1/workflows/{id}/edges` | POST | ✅ | 创建边 |
| `/api/v1/workflows/{id}/edges/{eid}` | DELETE | ✅ | 删除边 |
| `/api/v1/workflows/{id}/save` | PUT | ✅ | 全量替换节点/边 |
| `/api/v1/media/` | GET | ✅ | — |
| `/api/v1/media/upload` | POST | ✅ | MinIO 上传 |
| `/api/v1/media/{id}` | GET | ✅ | — |
| `/api/v1/media/{id}/presign` | GET | ✅ | MinIO 预签名 URL |
| `/api/v1/media/{id}/download` | GET | ✅ | MinIO 代理下载 |
| `/api/v1/media/{id}` | DELETE | ✅ | MinIO + DB 删除 |
| `/api/v1/render/` | POST | ⚠️ | 写库未触发 Celery |
| `/api/v1/render/{id}` | GET | ✅ | — |
| `/api/v1/render/{id}/cancel` | POST | ⚠️ | 未撤销 Celery |
| `/api/v1/collab/status` | GET | ✅ | 硬编码状态 |

## 数据库表结构

| 表名 | 模型 | 状态 |
|------|------|------|
| `users` | User | ✅ 已创建 |
| `projects` | Project | ✅ 已创建 |
| `workflow_nodes` | WorkflowNode | ✅ 已创建 |
| `workflow_edges` | WorkflowEdge | ✅ 已创建 |
| `media_assets` | MediaAsset | ✅ 已创建 |
| `render_tasks` | RenderTask | ✅ 已创建 |

## 前端 Store 数据持久化现状

| Store | 当前存储 | 目标存储 | 状态 |
|-------|---------|---------|------|
| authStore | 后端 API | 后端 API | ✅ 已完成 |
| projectStore | 后端 API | 后端 projectApi | ✅ 已完成 |
| canvasStore | 内存（通过 projectStore 间接保存） | 后端 workflowApi | ⚠️ 间接对接 |
| timelineStore | 内存 | 后端 workflowApi | ❌ 未对接 |
| autoSaveStore | localStorage | 后端 API | ❌ 未对接 |
| historyStore | 内存（刷新丢失） | 可保持内存 | ✅ 无需后端 |

## Mock 数据目录结构

```
frontend/src/mock/
  ├── index.ts          # 统一导出
  ├── mediaMock.ts      # isMockMedia, isMockAsset, generateMockAssets, getMockThumbnailUrl, mockDelay
  └── canvasMock.ts     # MOCK_NODES, MOCK_EDGES, loadMockData
```

- `npm run dev:mock` — Mock 模式（`--mode mock`，读取 `.env.mock`）
- `npm run dev` — 正常模式（走真实后端 API）
