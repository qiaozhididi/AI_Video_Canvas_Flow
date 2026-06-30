# AI Canvas Flow — 开发路线图与未完成功能清单

> 更新时间: 2026-06-30

## 当前项目状态概览

| 层级 | 模块 | 状态 | 说明 |
|------|------|------|------|
| 前端 | 画布编辑器 | ✅ 完成 | 节点拖放、连线、属性编辑、撤销重做 |
| 前端 | 媒体库 | ✅ 完成 | MinIO 上传/下载/缩略图懒加载/分页/拖拽上传 |
| 前端 | 渲染中心 | ✅ 完成 | 真实 API 对接，任务创建/列表/轮询/取消/下载，显示 node_label/project_name |
| 前端 | 执行工作流 | ✅ 完成 | 单节点执行 + 全工作流拓扑编排（Kahn 算法按层并行） |
| 前端 | 模板市场 | ✅ 完成 | 列表搜索/分类筛选/克隆/发布/取消发布，已对接 PostgreSQL |
| 前端 | 设置页 | ✅ 完成 | AI 配置面板 + 用户资料持久化（username/email/avatar_url） |
| 前端 | 时间轴 | ✅ 完成 | rAF 播放循环 + 加入时间轴按钮 + 双向联动 + 片段 resize 拖拽（吸附/tooltip/视觉反馈） |
| 前端 | 视频预览 | ✅ 完成 | 接入选中节点 outputArtifacts + 时间轴双向联动 |
| 前端 | 自动保存 | ✅ 完成 | 双防抖+5 快照+崩溃恢复，已对接 PostgreSQL 后端（project_snapshots 表） |
| 前端 | AI 快速生成 | ✅ 完成 | 自然语言描述 → LLM 生成工作流节点/边，支持替换/追加模式 |
| 前端 | 节点字段统一 | ✅ 完成 | 手动拖拽与 AI 生成节点 params 字段统一（prompt/size/model_id 等） |
| 后端 | 认证 API | ✅ 完成 | 注册/登录/JWT + PUT /me 资料更新 |
| 后端 | 项目 CRUD | ✅ 完成 | 级联删除 |
| 后端 | 工作流 CRUD | ✅ 完成 | 7 端点全对接数据库 |
| 后端 | 媒体资产 | ✅ 完成 | MinIO 上传/presign/下载/删除 |
| 后端 | 渲染任务 | ✅ 完成 | 创建触发 Celery，进度实时写回 DB，支持取消，返回 node_label/project_name |
| 后端 | AI 可配置系统 | ✅ 完成 | Provider/Model CRUD + 默认配置 + LLM 调用封装 |
| 后端 | AI 工作流生成 | ✅ 完成 | POST /ai/generate-workflow，LLM 解析描述生成节点/边 + 自动布局 |
| 后端 | Celery 任务 | ✅ 完成 | 渲染任务 + AI 推理任务，RabbitMQ 4.x 兼容 |
| 后端 | WebSocket | ✅ 完成 | Socket.IO ASGI + JWT 鉴权 + 房间成员管理 + 远端光标同步 |
| 后端 | 模板市场 | ✅ 完成 | 列表/克隆/发布/取消发布 4 端点 |
| 后端 | 快照系统 | ✅ 完成 | project_snapshots 表 + CRUD + 单事务恢复 + 5 auto 上限 |

---

## 整体进度

| 层面 | 完成度 | 说明 |
|------|--------|------|
| 后端 API | **100%** | 全部核心端点已实现（含 templates/snapshots/collaboration WS 鉴权 + AI 工作流生成） |
| 前端 API 客户端 | **100%** | 所有后端端点均有对应前端方法（含 AI Provider/Model + templates + snapshots + generateWorkflow） |
| 前端 Store 对接 | **90%** | authStore/projectStore/canvasStore(间接)/autoSaveStore/collabStore 已对接；timelineStore 通过快照恢复部分对接 |
| 前端页面对接 | **100%** | Login/Home/RenderCenter/Settings/Templates/Editor(执行工作流+预览+时间轴+AI 生成) 全部对接；MediaLibrary 有 Mock 降级 |

---

## ✅ 已完成任务

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

### 4. 渲染中心前后端打通 + Celery 任务 + AI 可配置系统
- **后端**: render.py 创建任务触发 Celery `run_render_task.delay()`，进度实时写回 DB
- **后端**: cancel 端点通过 `AsyncResult.revoke()` 撤销 Celery 任务
- **后端**: Celery worker 兼容 RabbitMQ 4.x（durable 队列 + 禁用 gossip/mingle/pidbox）
- **后端**: AI Provider/Model 数据库模型 + CRUD API + 默认配置自动初始化
- **后端**: ai_service.py 封装 LLM 调用（OpenAI 兼容格式），验证豆包 Seed 2.1 Turbo
- **前端**: RenderCenter.tsx 对接 renderApi，3s 轮询进度，创建/取消/下载
- **前端**: Settings.tsx 新增 AI 配置标签页（Provider/Model 管理）
- **前端**: apiClient.ts 扩展 renderApi + aiApi
- **修复**: Celery autodiscover `[tasks]` 为空 → `__init__.py` 显式导入任务模块
- **修复**: render_tasks.py 使用 `async_session_factory` 替代不存在的 `async_session`
- **修复**: 旧 Celery worker 进程缓存 → kill 全部旧进程 + 清除 `__pycache__`
- **涉及文件**: render.py, render_tasks.py, ai_tasks.py, celery_app.py, ai.py, ai_provider.py, ai_model.py, ai_service.py, config.py, RenderCenter.tsx, Settings.tsx, apiClient.ts

### 5. 画布节点触发渲染任务 + 工作流编排引擎
- **后端**: render_tasks 表新增 `node_id` 列；`RenderTaskCreate` schema 扩展 `node_id`/`model_id`/`prompt`/`input_artifacts`
- **后端**: 新增 `GET /ai/models/default` 端点（AI 推理节点自动选模型）
- **后端**: Celery `run_render_task` 按 `task_type` 前缀路由（`ai_*` 走 AI 推理，其他走模拟渲染）
- **后端**: 修复 Celery 事件循环不匹配（创建 Celery 专用 async engine + session factory + 复用事件循环）
- **后端**: 修复 `time.sleep()` 阻塞事件循环 → `await asyncio.sleep()`
- **后端**: 进度值改为 0-100 整数存储（前端直接展示，避免 0.0-1.0 转换）
- **后端**: AI 任务路由细化：`ai_text2img` 走 `call_image_gen`（Images API），其他走 `call_llm`（Chat Completions API）
- **后端**: 工作流保存先 flush 节点再插边，避免 `workflow_edges_target_node_id_fkey` 外键冲突
- **前端**: 新增 `workflowExecutor.ts` 编排引擎（Kahn 拓扑排序 + 按层并行执行 + 单节点执行）
- **前端**: Editor.tsx 属性面板替换模拟执行为真实 `executeNode()`，新增 AI 模型下拉选择器
- **前端**: EditorLayout.tsx "执行工作流"按钮绑定 `executeWorkflow()`，显示编排进度（已完成/总节点数）
- **前端**: workflowExecutor.ts 收集上游输入节点 `params.text`/`params.url` 为虚拟 artifacts 传给下游
- **涉及文件**: render.py, render_tasks.py, ai.py, render_task.py, 19c11929fcbb_add_node_id_to_render_tasks.py, workflowExecutor.ts, Editor.tsx, EditorLayout.tsx, apiClient.ts, canvasStore.ts

### 6. WebSocket 实时协作完善
- **后端**: Socket.IO ASGI 挂载共端口（`ASGIApp(sio, other_asgi_app=app)`，走 `/socket.io/`）
- **后端**: connect 事件 JWT 鉴权（query string 解析 token + `jose.jwt.decode` 验证 + 查 DB 获取 username，无 token/无效返回 False 拒绝连接）
- **后端**: `_room_members` 全局 dict 维护房间成员清单，join_project ack 返回在线用户快照
- **后端**: user_joined/user_left 广播（用 `_remove_member_from_room` 返回值守卫，与 disconnect 一致）
- **后端**: node_update/edge_update/cursor_move 仅广播不写 DB（依赖现有 autoSaveStore 双防抖保存）
- **后端**: cursor_move 广播自包含 user_id/username + 完整 sid（解决前端按 sid 关联失败问题）
- **前端**: 新建 `collabStore.ts` 封装 Socket.IO 客户端（connect/disconnect/joinProject/leaveProject/emit*/on* + cursor 50ms 节流 + connect_error 处理）
- **前端**: canvasStore 接入 collabStore 实现实时同步（9 个变更方法加 emit + applyRemoteNodeUpdate/applyRemoteEdgeUpdate 无回环）
- **前端**: EditorLayout 接入 collabStore + 在线用户头像列表 UI（最多 5 个 +N，当前用户 border-neon-blue 标记）
- **前端**: RemoteCursors 组件用 `useViewport()` 订阅 viewport 变化渲染远端光标（按 user_id hash 取色）
- **前端**: Canvas.tsx onNodesChange/onEdgesChange/onConnect 补协作广播（拖动结束/update、删除/delete、连线改用 canvasStore.addEdge）
- **设计决策**: query string 传 JWT token（避免 CORS preflight + 适配 Socket.IO 协议）；协作变更不写 DB（依赖现有自动保存）；完整协作（含远端光标）
- **验证**: 后端 14/14 端到端验证点通过（verify_task6.py），前端 tsc clean
- **涉及文件**:
  - `backend/app/ws/collaboration.py`
  - `frontend/src/stores/collabStore.ts`（新建）
  - `frontend/src/stores/canvasStore.ts`
  - `frontend/src/components/EditorLayout.tsx`
  - `frontend/src/components/canvas/Canvas.tsx`
  - `frontend/src/components/canvas/RemoteCursors.tsx`（新建）
  - `frontend/src/types/canvas.ts`
  - `backend/verify_task1.py`、`backend/verify_task6.py`
  - `docs/superpowers/plans/2026-06-27-websocket-collaboration.md`

### 7. 编辑器自动保存后端化
- **后端**: project_snapshots 表 + Alembic 迁移（JSONB 存 nodes/edges/timelineData，含 project_id+source+created_at 索引）
- **后端**: snapshots.py 快照 CRUD API（POST/GET/GET latest/DELETE）+ POST /snapshots/{id}/restore 单事务恢复端点
- **后端**: 5 auto 快照上限策略（插入前清理最旧 auto 快照，manual 不计数）
- **后端**: 修复 delete_project 级联删除遗漏（workflow_nodes/edges/snapshots 手动级联）
- **前端**: autoSaveStore 移除 localStorage，saveNow() 改 async 调 snapshotApi.create()
- **前端**: checkRecovery() 改 async 调 snapshotApi.getLatest()，对比 created_at vs project.updatedAt
- **前端**: restoreSnapshot() 调 snapshotApi.restore() 后刷新本地 stores + refreshCurrentProject 更新 updatedAt
- **前端**: projectStore 新增 refreshCurrentProject 方法避免恢复对话框误重弹
- **涉及文件**: project_snapshot.py, snapshots.py, snapshot.py, projects.py, autoSaveStore.ts, projectStore.ts, apiClient.ts, EditorLayout.tsx

### 8. 设置页持久化 + 模板市场
- **后端**: auth.py 新增 PUT /me 端点（UserUpdateRequest + 唯一性校验 + avatar_url）
- **后端**: Project 模型新增 is_template/template_category/template_tags 字段 + Alembic 迁移 + seed 3 官方模板
- **后端**: templates.py 新增 4 端点（GET /templates/ 列表搜索 + POST /templates/{id}/clone 克隆 + POST /projects/{id}/publish 发布 + DELETE /templates/{id} 取消发布）
- **后端**: clone 复制 nodes/edges，新节点 ID 加项目前缀避免冲突；publish/unpublish 校验 owner
- **前端**: Settings.tsx 新增 ProfileTab 组件对接 authApi.getMe + authApi.update
- **前端**: Templates.tsx 重写移除 MOCK，对接 templateApi.list（debounce 搜索）+ 分类筛选 + clone 跳转编辑器
- **前端**: Home.tsx 项目卡片新增"发布为模板"按钮 + Modal（分类/标签输入）
- **前端**: apiClient.ts 新增 UserUpdateRequest/TemplateResponse/TemplatePublishRequest 类型 + authApi.update + templateApi
- **涉及文件**: auth.py, project.py, templates.py, schemas/project.py, router.py, a1b2c3d4e5f6_add_template_fields_to_projects.py, Settings.tsx, Templates.tsx, Home.tsx, apiClient.ts

### 9. 核心创作闭环（视频预览 + 时间轴播放 + 双向联动）
- **前端**: timelineStore 新增 requestAnimationFrame 播放循环（tick 用 getState 取最新值避免闭包陈旧，到 duration 自动 pause；rAF 时间戳 delta clamp 50ms 防止后台/自动化环境跳变）
- **前端**: VideoPreview 接入选中节点 outputArtifacts（优先 video → image，相对路径加 `/api/v1/media/` 前缀）
- **前端**: 时间轴 ↔ 视频预览双向联动（currentTime 跳转 + onTimeUpdate 回写，0.3s 阈值防回环，onTimeUpdate 用 ref 模式避免闭包陈旧）
- **前端**: PropertyPanelWithHistory 扩展 outputArtifacts 展示 + 「加入时间轴」按钮（按 artifact 类型匹配轨道，image 3s / video/audio 5s 默认时长）
- **前端**: Timeline.tsx 片段 resize/move 拖拽 UI（Pointer Events + setPointerCapture try-catch + 统一 DragState + 吸附对齐 8px 阈值 + 拖拽时长 tooltip + cursor 锁定视觉反馈）
- **前端**: projectStore.loadProjectToCanvas 从最新 auto 快照恢复 timelineData（打开项目时时间轴状态恢复）
- **验证**: 19 项端到端验证清单，6 项 MCP 自动化通过 + 13 项待人工；rAF 播放速度从 80x 修复到 0.999x；拖拽 4 项优化全部通过
- **合并**: merge commit 7a4bd7e（feature/core-creation-loop → main）
- **涉及文件**: timelineStore.ts, VideoPreview.tsx, Editor.tsx, Timeline.tsx, projectStore.ts, verify_core_loop.md
- **后续优化**: rAF clamp（commit c5f5d96）、clip resize 拖拽（commit 43d65a2）、Timeline 重构统一 DragState（commit 6c122ec）、快照恢复 timelineData（commit e5a034d）

### 10. AI 快速生成工作流
- **后端**: ai_service.py 新增 `generate_workflow(db, description, model_id)` — LLM 解析自然语言描述 → 生成节点/边 JSON + `_compute_layout` 自动网格布局
- **后端**: ai.py 新增 `POST /ai/generate-workflow` 端点，支持 `mode: replace | append`（replace 需二次确认）
- **后端**: LLM Prompt 内嵌节点子类型白名单（text_to_image/image_to_video/text_to_speech/upscale/style_transfer/remove_bg/extend_image/text_input/image_input/video_output/image_output/audio_output）+ JSON Schema 约束
- **后端**: `_parse_llm_json` 容错解析（剥离 ```json fence + 尾部逗号清理 + 降级 ast.literal_eval）
- **前端**: canvasTransform.ts 新增 `toCanvasNode`/`toCanvasEdge` 转换器（后端 NodeCreateRequest → 前端 CanvasNode，config 解包到 data）
- **前端**: AiGenerateModal.tsx 弹窗组件（描述输入框 + 模式选择 + Ctrl/Cmd+Enter 提交 + 错误提示）
- **前端**: canvasStore.ts 新增 `loadGeneratedWorkflow` 方法（replace 清空画布 / append 追加 + 自动 fitView）
- **前端**: EditorLayout.tsx 工具栏新增「AI 生成」按钮接入弹窗，生成后通过 `fitViewToken` 触发 Canvas 自适应视图
- **前端**: Canvas.tsx 订阅 `fitViewToken` 变化调用 `fitView()`
- **测试**: backend/tests/test_ai_generate.py 5 个单元测试（含 mock LLM 响应、布局计算、字段映射）
- **合并**: merge commit 2693a9c（feature/ai-quick-generate → main，--no-ff），11 文件 +958/-47
- **涉及文件**: ai_service.py, ai.py, test_ai_generate.py, canvasTransform.ts, AiGenerateModal.tsx, canvasStore.ts, EditorLayout.tsx, Canvas.tsx, apiClient.ts
- **验证文档**: frontend/verify_ai_generate.md（49 项验证清单）

### 11. 节点字段统一与技术债清理（第 1 步）
- **背景**: 手动拖拽节点与 AI 生成节点 params 字段不一致（如 text_to_image 用 model/width/height/steps vs prompt/size/model_id）
- **后端**: canvas.ts NODE_TEMPLATES.defaultParams 与后端 NODE_DEFAULT_PARAMS 对齐
- **前端**: PropertyPanelWithHistory 改用 `Object.entries().map()` 动态渲染 params，不硬编码字段名
- **前端**: AI 生成的 text_to_image 节点统一使用 `prompt`/`size`/`model_id`；image_to_video 使用 `prompt`/`duration`
- **修复**: ai.py 第 318 行 `user.id` → `user`（CurrentUser 返回 user_id 字符串）
- **涉及文件**: ai.py, canvas.ts, Editor.tsx
- **后续待办**: 第 2 步执行链 params 读取（workflowExecutor.ts + RenderTaskCreate schema + render_tasks.py）

---

## 下一阶段开发计划

### 阶段二：编辑器自动保存后端化（P1）✅ 已完成

> 详见上方「已完成任务 #7」。project_snapshots 表 + CRUD + 单事务恢复 + 5 auto 上限，autoSaveStore 移除 localStorage 切换到 PostgreSQL。

---

### 阶段三：设置页 + 模板市场（P2）✅ 已完成

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

### 阶段四：WebSocket 协作（P2）

> ✅ 已完成（2026-06-28，merge commit b62a44d）。详见上方「已完成任务 #6」。

> 注：执行工作流按钮已在阶段一完成（见已完成任务 #5）

---

### 阶段五：增强体验（P3）

#### 10. 时间轴播放驱动 ✅ 已完成
- requestAnimationFrame 播放循环（rAF timestamp delta clamp 50ms）
- 片段 resize 拖拽 UI（Pointer Events + 吸附对齐 + tooltip + 视觉反馈）

#### 11. 视频预览联动 ✅ 已完成
- 播放器与时间轴同步（currentTime 跳转 + onTimeUpdate 回写，0.3s 阈值防回环）
- 执行工作流后输出视频传入 VideoPreview（接入选中节点 outputArtifacts）

> #10/#11 详见上方「已完成任务 #9」，merge commit 7a4bd7e。

#### 12. AI 快速生成 ✅ 已完成
- 输入描述 → LLM API → 生成工作流节点/边
- 详见上方「已完成任务 #10」（merge commit 2693a9c）

#### 13. 节点快捷操作 ⏳ 待开发
- 复制/粘贴、全选/框选、对齐工具

---

## 后端 API 完整清单

| 端点 | 方法 | 状态 | 备注 |
|------|------|------|------|
| `/api/v1/auth/register` | POST | ✅ | — |
| `/api/v1/auth/login` | POST | ✅ | — |
| `/api/v1/auth/me` | GET | ✅ | — |
| `/api/v1/auth/me` | PUT | ✅ | 更新 username/email/avatar_url（唯一性校验） |
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
| `/api/v1/render/` | GET | ✅ | 任务列表 |
| `/api/v1/render/` | POST | ✅ | 创建 + 触发 Celery（支持 node_id/model_id/prompt/input_artifacts） |
| `/api/v1/render/{id}` | GET | ✅ | 任务状态 |
| `/api/v1/render/{id}/cancel` | POST | ✅ | AsyncResult.revoke |
| `/api/v1/ai/providers` | GET/POST | ✅ | AI Provider CRUD |
| `/api/v1/ai/providers/{id}` | PUT/DELETE | ✅ | AI Provider CRUD |
| `/api/v1/ai/models` | GET/POST | ✅ | AI Model CRUD |
| `/api/v1/ai/models/{id}` | PUT/DELETE | ✅ | AI Model CRUD |
| `/api/v1/ai/models/default` | GET | ✅ | 获取默认 AI 模型（AI 推理节点自动选模型） |
| `/api/v1/ai/generate-workflow` | POST | ✅ | AI 快速生成工作流（mode: replace/append，LLM 解析描述生成节点/边） |
| `/api/v1/projects/{id}/snapshots` | POST | ✅ | 创建快照（auto 源受 5 条上限） |
| `/api/v1/projects/{id}/snapshots` | GET | ✅ | 快照列表（可按 source 筛选） |
| `/api/v1/projects/{id}/snapshots/latest` | GET | ✅ | 获取最新快照 |
| `/api/v1/snapshots/{id}` | GET | ✅ | 快照详情 |
| `/api/v1/snapshots/{id}` | DELETE | ✅ | 删除快照 |
| `/api/v1/snapshots/{id}/restore` | POST | ✅ | 单事务恢复快照到 nodes/edges |
| `/api/v1/templates/` | GET | ✅ | 模板列表（支持 q 搜索 name/tags + category 筛选） |
| `/api/v1/templates/{id}/clone` | POST | ✅ | 克隆模板为新项目（复制 nodes/edges，ID 加前缀） |
| `/api/v1/projects/{id}/publish` | POST | ✅ | 发布项目为模板（category + tags） |
| `/api/v1/templates/{id}` | DELETE | ✅ | 取消模板发布（仅 owner） |
| `/api/v1/collab/status` | GET | ✅ | 协作服务状态检查（实际协作走 Socket.IO `/socket.io/`） |

## 数据库表结构

| 表名 | 模型 | 状态 |
|------|------|------|
| `users` | User | ✅ 已创建 |
| `projects` | Project | ✅ 已创建（含 is_template/template_category/template_tags 字段 + ix_projects_is_template 索引） |
| `workflow_nodes` | WorkflowNode | ✅ 已创建 |
| `workflow_edges` | WorkflowEdge | ✅ 已创建 |
| `media_assets` | MediaAsset | ✅ 已创建 |
| `render_tasks` | RenderTask | ✅ 已创建（含 node_id 列） |
| `ai_providers` | AiProvider | ✅ 已创建 |
| `ai_models` | AiModel | ✅ 已创建 |
| `project_snapshots` | ProjectSnapshot | ✅ 已创建（JSONB 存 nodes/edges/timelineData + source 索引 + 5 auto 上限） |

## 前端 Store 数据持久化现状

| Store | 当前存储 | 目标存储 | 状态 |
|-------|---------|---------|------|
| authStore | 后端 API | 后端 API | ✅ 已完成 |
| projectStore | 后端 API | 后端 projectApi | ✅ 已完成 |
| canvasStore | 内存（通过 projectStore 间接保存） | 后端 workflowApi | ⚠️ 间接对接 |
| timelineStore | 内存（通过快照恢复） | 后端 snapshotApi | ⚠️ 部分对接（loadProjectToCanvas 从最新 auto 快照恢复 timelineData；主动保存依赖 autoSaveStore 快照） |
| autoSaveStore | 后端 API | 后端 API | ✅ 已完成（async 调 snapshotApi，localStorage 已移除，5 auto 上限） |
| collabStore | 内存（socket 事件） | 内存（不写 DB） | ✅ 已完成（协作变更依赖 autoSaveStore 持久化） |
| historyStore | 内存（刷新丢失） | 可保持内存 | ✅ 无需后端 |

## Mock 数据目录结构

```
frontend/src/mock/
  ├── index.ts          # 统一导出
  ├── mediaMock.ts      # isMockMedia, isMockAsset, generateMockAssets, getMockThumbnailUrl, mockDelay
  ├── canvasMock.ts     # MOCK_NODES, MOCK_EDGES, loadMockData
  └── renderMock.ts     # Mock 渲染任务数据
```

- `npm run dev:mock` — Mock 模式（`--mode mock`，读取 `.env.mock`）
- `npm run dev` — 正常模式（走真实后端 API）

## Celery Worker 启动方式

```bash
cd backend
.venv/bin/python -m celery -A app.tasks.celery_app worker \
  --loglevel=info \
  --pool=solo \
  --without-mingle --without-gossip --without-heartbeat
```

> 注意：RabbitMQ 4.x 兼容性需要 `--without-mingle --without-gossip --without-heartbeat` 参数
