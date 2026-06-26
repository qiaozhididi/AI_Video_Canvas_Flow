# AI Canvas Flow — 开发路线图与未完成功能清单

> 更新时间: 2026-06-26

## 当前项目状态概览

| 层级 | 模块 | 状态 | 说明 |
|------|------|------|------|
| 前端 | 画布编辑器 | ✅ 完成 | 节点拖放、连线、属性编辑、撤销重做 |
| 前端 | 媒体库 | ❌ Stub | 全量 MOCK 数据 |
| 前端 | 渲染中心 | ❌ Stub | 全量 MOCK 数据 |
| 前端 | 模板市场 | ❌ Stub | 全量 MOCK 数据 |
| 前端 | 设置页 | ❌ Stub | 保存无持久化 |
| 前端 | 时间轴 | ⚠️ 部分 | 无播放驱动循环 |
| 前端 | 视频预览 | ⚠️ 部分 | 无视频源传入 |
| 前端 | 执行工作流 | ❌ Stub | 按钮无逻辑 |
| 后端 | 认证 API | ✅ 完成 | 注册/登录/JWT |
| 后端 | 项目 CRUD | ✅ 完成 | 级联删除 |
| 后端 | 工作流 CRUD | ❌ 桩代码 | 6 个端点全 return 空值 |
| 后端 | 媒体资产 | ⚠️ 部分 | MinIO 未接入 |
| 后端 | 渲染任务 | ⚠️ 部分 | Celery 任务未触发 |
| 后端 | WebSocket | ⚠️ 部分 | 广播可用，缺鉴权/持久化 |
| 后端 | Celery 任务 | ❌ 骨架 | 仅模拟进度 |

---

## 优先级排序的开发任务

### P0 — 核心功能（阻塞基本使用）

#### 1. 工作流节点/边 CRUD 对接数据库
- **后端**: 实现 `app/api/workflows.py` 的 6 个桩代码端点
  - `GET /workflows/{id}/nodes` — 查询 workflow_nodes 表
  - `POST /workflows/{id}/nodes` — 创建节点记录
  - `DELETE /workflows/{id}/nodes/{nid}` — 删除节点
  - `GET /workflows/{id}/edges` — 查询 workflow_edges 表
  - `POST /workflows/{id}/edges` — 创建边记录
  - `DELETE /workflows/{id}/edges/{eid}` — 删除边
- **前端**: `projectStore` 改用 `projectApi`/`workflowApi` 替代 localStorage
- **涉及文件**:
  - `backend/app/api/workflows.py`
  - `frontend/src/stores/projectStore.ts`
  - `frontend/src/stores/canvasStore.ts`
  - `frontend/src/utils/apiClient.ts`

#### 2. 项目保存/加载对接后端 API
- **前端**: `projectStore.saveCurrentProject()` 调用 `projectApi.update()` 而非 localStorage
- **前端**: 编辑器加载时从 `projectApi.get()` 获取项目数据
- **涉及文件**:
  - `frontend/src/stores/projectStore.ts`
  - `frontend/src/components/EditorLayout.tsx`

#### 3. 媒体库 — 上传/列表/删除
- **前端**: `MediaLibrary.tsx` 调用 `mediaApi` 替代 MOCK 数据
- **后端**: MinIO 上传接入（`media.py` 的 upload 端点）
- **涉及文件**:
  - `frontend/src/pages/MediaLibrary.tsx`
  - `backend/app/api/media.py`
  - `backend/app/services/minio_client.py`（需新建）

---

### P1 — 重要功能（影响体验）

#### 4. 渲染中心 — 任务提交/状态/下载
- **前端**: `RenderCenter.tsx` 调用 `renderApi` 替代 MOCK 数据
- **后端**: 渲染任务创建时触发 Celery 任务 (`run_render_task.delay()`)
- **后端**: 实现 Celery 任务的真正 AI 调用逻辑
- **涉及文件**:
  - `frontend/src/pages/RenderCenter.tsx`
  - `backend/app/api/render.py`
  - `backend/app/tasks/render_tasks.py`
  - `backend/app/tasks/ai_tasks.py`

#### 5. WebSocket 实时协作完善
- **后端**: Socket.IO 连接时验证 JWT
- **后端**: node_update/edge_update 事件同时写入数据库
- **前端**: 创建 WebSocket 客户端连接，监听远端节点/边变更
- **前端**: 光标位置广播 + 远端光标渲染
- **涉及文件**:
  - `backend/app/ws/collaboration.py`
  - `frontend/src/stores/collabStore.ts`（需新建）
  - `frontend/src/components/canvas/Canvas.tsx`

#### 6. 时间轴播放驱动
- **前端**: 实现 requestAnimationFrame 播放循环
- **前端**: 片段 resize 拖拽 UI
- **前端**: 片段添加入口（从画布节点拖入时间轴）
- **涉及文件**:
  - `frontend/src/stores/timelineStore.ts`
  - `frontend/src/components/timeline/Timeline.tsx`

---

### P2 — 增强功能（提升完成度）

#### 7. 执行工作流按钮
- **前端**: EditorLayout 的"执行工作流"按钮添加 onClick
- **前端**: 拓扑排序 + 逐节点提交渲染任务
- **前端**: 进度实时更新（WebSocket 或轮询）
- **涉及文件**:
  - `frontend/src/components/EditorLayout.tsx`
  - `frontend/src/stores/canvasStore.ts`
  - `frontend/src/utils/workflowExecutor.ts`（需新建）

#### 8. 模板市场
- **后端**: 新增模板 CRUD API（或使用项目表 + is_template 标记）
- **前端**: "从模板创建"按钮 → 模板选择 → 创建项目
- **前端**: "导入"按钮 → 调用 projectApi.create 并复制节点/边
- **涉及文件**:
  - `frontend/src/pages/Templates.tsx`
  - `frontend/src/pages/Home.tsx`
  - `backend/app/api/templates.py`（需新建）

#### 9. AI 快速生成
- **前端**: 输入描述 → 调用 LLM API → 生成工作流节点/边 → 创建项目
- **涉及文件**:
  - `frontend/src/pages/Home.tsx`
  - `frontend/src/utils/aiGenerator.ts`（需新建）
  - `backend/app/api/ai.py`（需新建）

#### 10. 设置页持久化
- **前端**: 读取/保存用户信息（调用 authApi.getMe + 新的 userApi.update）
- **前端**: API Key 存储到后端或 localStorage
- **前端**: 存储用量从后端获取（聚合 media_assets 表）
- **涉及文件**:
  - `frontend/src/pages/Settings.tsx`
  - `backend/app/api/auth.py`（扩展 PUT /me）

---

### P3 — 优化项（锦上添花）

#### 11. 视频预览联动
- 视频播放器与时间轴 currentTime/isPlaying 同步
- 执行工作流后将输出视频传入 VideoPreview

#### 12. 节点快捷操作
- 复制/粘贴节点 (Ctrl+C/V)
- 全选/框选
- 对齐/分布工具
- 节点折叠/展开

#### 13. 自动保存优化
- autoSaveStore 切换到后端 API 存储
- 崩溃恢复改为服务器端校验

#### 14. 键盘快捷键完善
- Delete 删除节点（已实现）
- Ctrl+D 复制节点
- Space 平移画布

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
| `/api/v1/workflows/{id}/nodes` | GET | ❌ | return [] |
| `/api/v1/workflows/{id}/nodes` | POST | ❌ | return None |
| `/api/v1/workflows/{id}/nodes/{nid}` | DELETE | ❌ | 空函数 |
| `/api/v1/workflows/{id}/edges` | GET | ❌ | return [] |
| `/api/v1/workflows/{id}/edges` | POST | ❌ | return None |
| `/api/v1/workflows/{id}/edges/{eid}` | DELETE | ❌ | 空函数 |
| `/api/v1/media/` | GET | ✅ | — |
| `/api/v1/media/upload` | POST | ⚠️ | MinIO 未接入 |
| `/api/v1/media/{id}` | GET | ✅ | — |
| `/api/v1/media/{id}/presign` | GET | ⚠️ | 占位 URL |
| `/api/v1/media/{id}` | DELETE | ⚠️ | 未清理 MinIO |
| `/api/v1/render/` | POST | ⚠️ | 未触发 Celery |
| `/api/v1/render/{id}` | GET | ✅ | — |
| `/api/v1/render/{id}/cancel` | POST | ⚠️ | 未撤销 Celery |
| `/api/v1/collab/status` | GET | ✅ | — |
| `/health` | GET | ✅ | — |

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

| Store | 当前存储 | 目标存储 |
|-------|---------|---------|
| authStore | 后端 API | ✅ 已完成 |
| projectStore | localStorage | 后端 projectApi |
| canvasStore | 内存（通过 projectStore 间接 localStorage） | 后端 workflowApi |
| timelineStore | 内存（通过 projectStore 间接 localStorage） | 后端 workflowApi |
| autoSaveStore | localStorage | 后端 API |
| historyStore | 内存（刷新丢失） | 可保持内存 |
