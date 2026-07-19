# NestJS vs Python 后端全面对比报告

## 日期: 2026-07-15
## 方法: 6 维度并行子代理对比
## 范围: 数据库字段、API 路由、env 配置、服务层逻辑、异步任务、WebSocket

---

## 统计总览

| 维度 | Critical | Important | Minor |
|------|----------|-----------|-------|
| 数据库字段 | 1 | 10 | 7 |
| API 路由 | 7 | 17 | 8 |
| env 配置 | 0 | 3 | 2 |
| 服务层逻辑 | 9 | 17 | 10 |
| 异步任务 | 5 | 8 | 9 |
| WebSocket | 1 | 6 | 7 |
| **去重合并后** | **18** | **35** | **28** |

---

## Critical 问题（18 项，必须修复）

### 数据库 Schema

**C1. users.created_at 列不存在（导致所有用户接口失败）**
- Python `app/models/user.py` 无 `created_at` 列，DB 实际不存在此列
- NestJS `user.entity.ts:11` 声明了 `@CreateDateColumn({ name: 'created_at' })`
- 影响：TypeORM SELECT/INSERT 包含 `created_at` → PostgreSQL 报 `column does not exist` → 登录/注册/刷新全部失败
- 修复：从 User 实体移除 `createdAt` 字段

### API 路由

**C2. 协作状态路由路径不兼容**
- Python: `GET /api/v1/status`（`collaboration.py:23`）
- NestJS: `GET /api/v1/collab/status`（`collaboration.controller.ts:6`）
- 修复：NestJS Controller 改为 `@Controller()` + `@Get('status')`

**C3. 工作流节点/边响应缺少时间戳字段**
- Python `create_node`/`list_edges`/`create_edge` 返回 `created_at`/`updated_at`
- NestJS `nodeToResponse`/`edgeToResponse`/`listEdges` 不含时间戳
- 修复：补充 `created_at`/`updated_at` 到响应

**C4. 渲染导出任务缺少项目所有权校验（安全漏洞）**
- Python `render.py:258` 校验项目所有权
- NestJS `render.service.ts:164` 无校验，任意用户可对他人项目发起导出
- 修复：`exportVideo` 开头增加所有权校验

**C5. AI Provider 删除行为完全相反**
- Python `ai.py:148` 级联删除关联模型
- NestJS `ai.service.ts:52` 拒绝删除有关联模型的 Provider
- 修复：NestJS 改为级联删除

**C6. 媒体下载缺少 inline 模式**
- Python 支持 `?download=true/false`，默认 inline（浏览器预览）
- NestJS 恒为 attachment（强制下载）
- 修复：增加 `download` query 参数

**C7. 媒体 presign 响应缺少 `expires_in` 字段**
- Python 返回 `{url, expires_in: 3600}`
- NestJS 仅返回 `{url}`
- 修复：补充 `expires_in: 3600`

### 服务层逻辑

**C8. 导出服务为模拟实现，无 FFmpeg 合成**
- Python `export_service.py:54-183` 完整 FFmpeg 多轨混流
- NestJS `render.processor.ts:150-167` 仅模拟进度，无真实合成
- 修复：实现完整 FFmpeg 合成逻辑

**C9. 渲染任务缺少节点透传逻辑**
- Python 按 `image_output`/`audio_output`/`upscale` subtype 透传上游资产
- NestJS 统一生成模拟 PNG，丢弃上游真实素材
- 修复：按 subtype 分支处理

**C10. AI TTS API 完全不同**
- Python 用 Ark 异步任务 API + MinIO 持久化
- NestJS 用 OpenAI 同步 API + base64 返回
- 修复：NestJS 改用 Ark 异步 API

**C11. AI 图片生成缺少图生图支持**
- Python 有 `call_img2img` + 内部图片 base64 转换
- NestJS 无 `callImg2Img`，图生图功能缺失
- 修复：补充 `callImg2Img` 方法

**C12. AI 视频生成请求格式不兼容**
- Python image 在 content 数组中
- NestJS image 在顶层字段
- 修复：统一请求体格式

**C13. AI 工作流生成为极简 stub**
- Python 有完整 SYSTEM_PROMPT、白名单校验、Kahn 拓扑布局、参数预填
- NestJS 一句话 prompt、正则匹配 JSON、无布局/无预填
- 修复：完整移植 Python 逻辑

**C14. 工作流删除节点顺序错误（FK 违约风险）**
- Python 先删边后删节点
- NestJS 先删节点后删边 → 可能 FK 违约
- 修复：调整为先删边后删节点

**C15. AI 模型归属验证缺少 is_active 和 model_type 校验**
- Python 校验 expected_type + is_active
- NestJS 不校验，允许用 LLM 模型调图片生成、允许调用禁用模型
- 修复：补充校验

### 异步任务

**C16. 渲染任务未从 WorkflowNode 读取节点配置**
- Python 根据 `node_id` 从 DB 读取 `WorkflowNode.config`
- NestJS 强依赖调用方传入 params，漏传则丢失关键参数
- 修复：params 为空时查 WorkflowNode 补齐

**C17. AI 任务 result_url 格式不兼容**
- Python 直接用 AI 服务返回的临时 URL
- NestJS 下载转存 MinIO 生成持久路径
- 修复：统一策略（建议都转存 MinIO）
**状态：已解决（Task 8 已统一为 MinIO 转存策略，比 Python 临时 URL 更优）**

**C18. 任务取消语义不同**
- Python `revoke(terminate=True)` 终止运行中任务
- NestJS `discard()` 不终止运行中任务，只防重试
- 修复：NestJS process 内轮询 `isDiscarded` 主动退出

### WebSocket

**C19. TTL 清理协程未广播 lock_changed**
- Python 清理过期锁后广播 `lock_changed`（lock=null）
- NestJS 仅删除锁，不广播 → 前端锁状态永久不同步
- 修复：清理后广播 `lock_changed`

---

## Important 问题（35 项，建议修复）

### 数据库 Schema（10 项）
1. `workflow_nodes.position_x/y` 缺默认值 0.0 → NULL 插入失败
2. `workflow_nodes.label` nullable 不一致（Python 可空，NestJS NOT NULL）
3. `workflow_nodes.config` nullable 不一致
4. `projects.template_tags` json vs jsonb 类型不匹配
5. `render_tasks.status` 缺默认值 'pending'
6. `render_tasks.status` CHECK 约束未声明
7. `project_snapshots.source` 长度 16 vs 64
8. `project_invitations.expires_at` timestamp vs timestamptz
9. `workflow_nodes.position_x/y` float8 vs float4 精度差异
10. 多表外键 `ondelete CASCADE` 未在 NestJS 声明

### API 路由（10 项）
11. POST 默认状态码 200(Python) vs 201(NestJS) — 全局影响
12. DELETE 返回 204 无 body(Python) vs 200+{detail}(NestJS)
13. 注册冲突状态码 400(Python) vs 409(NestJS)
14. 项目所有权校验 404(Python) vs 403(NestJS) — 泄露项目存在性
15. AI 模型列表缺 `model_type` 筛选
16. AI Provider 列表不自动初始化默认配置
17. AI 默认模型查询缺回退逻辑（无默认时应用第一个 active）
18. AI 模型更新不支持修改 `provider_id`/`model_id`/`model_type`
19. generate-subtitles 解析失败静默返回空 vs Python 抛 422
20. 快照恢复不更新 `project.updated_at`

### 服务层逻辑（8 项）
21. 项目列表 is_template 过滤差异（Python 不过滤，NestJS 过滤）
22. 项目封面上传缺文件类型与大小校验
23. AI 错误消息丢失原始信息（NestJS 统一替换为"AI 服务暂时不可用"）
24. LLM 调用缺 temperature 参数
25. 媒体删除 MinIO 失败容错差异（Python 容忍，NestJS 阻止 DB 删除）
26. 快照 auto 上限处理差异（Python 删 1 条，NestJS 删多条）
27. 邀请创建/角色更新不校验 role 合法性
28. AI Provider 更新不支持修改 `platform`

### 异步任务（4 项）
29. 队列级重试策略不同（Python 不重试，NestJS 重试 3 次）
30. 失败时 task.status 与重试状态冲突（NestJS 重试期间 failed↔running 跳变）
31. size 默认值与格式不一致（Python 2k，NestJS 1024x1024）
32. 无 model_id 时行为相反（Python 模拟，NestJS 报错）

### WebSocket（2 项）
33. `node_update`/`edge_update` 缺编辑权限检查（viewer 可广播）
34. `renew_lock` 过期锁处理不同（Python 允许续租复活，NestJS 拒绝）

### env 配置（1 项）
35. CORS_ORIGINS 格式差异（Python JSON 数组，NestJS 逗号分隔）+ 默认端口范围差异（Python 5173-5183，NestJS 仅 5173）

---

## Minor 问题（28 项，可接受）

### 数据库（7 项）
- `media_assets.file_name` 长度 256 vs 255
- `projects.template_category` 长度 32 vs 64
- `users.username/email` 索引声明风格
- 时间戳默认值来源差异（均客户端默认）
- `render_tasks.celery_task_id` 语义复用
- UUID 主键 default 缺失（service 已补偿）
- role 默认值一致

### API（5 项）
- 渲染任务列表 `limit` 范围校验缺失
- AI 默认模型错误消息差异
- AI Provider `api_key` 脱敏格式差异
- AI Provider 响应多返回 `user_id`
- 克隆模板项目名格式差异（` 副本` vs ` (副本)`）

### 服务层（5 项）
- 密码哈希库不同但兼容（bcrypt vs bcryptjs）
- JWT 实现等价
- 用户 ID 生成方式不同但结果一致
- MinIO object key 格式不同（内部实现）
- 错误响应格式统一（FastApiCompatFilter 兼容层）

### 异步任务（5 项）
- Broker 选型不同（RabbitMQ vs Redis，功能等价）
- 队列名不同（celery vs render-tasks）
- 参数传递结构不同
- 数据库访问方式不同
- 事件循环处理不同

### WebSocket（4 项）
- ping/pong 实现方式不同
- acquire_lock 缺参数校验
- leave_project ack 返回不同
- force_release 权限拒绝字段名不同

### env 配置（2 项）
- DATABASE_URL 格式 `postgresql+asyncpg://`（NestJS 自动替换）
- NestJS .env.example 缺少 Celery 配置（架构差异，可接受）

---

## 修复优先级建议

### 第一优先级（阻塞核心功能）
1. **C1** users.created_at — 所有用户接口失败
2. **C8** 导出服务 FFmpeg — 导出功能不可用
3. **C13** AI 工作流生成 — 生成的节点无法使用
4. **C19** WebSocket TTL 清理不广播 — 协作锁状态不同步

### 第二优先级（安全/数据完整性）
5. **C4** 渲染导出缺所有权校验 — 越权风险
6. **C14** 删除节点 FK 违约 — 数据完整性风险
7. **C15** AI 模型归属验证缺失 — 资源滥用风险
8. **I-33** WebSocket 缺编辑权限检查 — 权限绕过

### 第三优先级（前端兼容性）
9. **C2** 协作状态路由 404
10. **C3** 工作流响应缺时间戳
11. **C5** Provider 删除行为相反
12. **C6** 媒体下载缺 inline 模式
13. **C7** presign 缺 expires_in
14. **I-11/I-12** POST/DELETE 状态码全局不一致

### 第四优先级（AI 服务兼容性）
15. **C10/C11/C12** AI TTS/图生图/视频生成 API 不兼容
16. **C16/C17** 渲染任务参数回填 + result_url 格式

### 第五优先级（行为对齐）
17. 数据库 Important 项（I1-I10）
18. 服务层 Important 项（I21-I28）
19. 异步任务 Important 项（I29-I32）

---

## 结论

NestJS 重构在**基础设施层**（配置、认证、路由结构、错误处理格式）与 Python 后端高度一致，但在**业务逻辑层**存在显著差异，尤其是：
1. **AI 服务**：多个 API 调用格式不兼容，工作流生成逻辑为 stub
2. **渲染/导出任务**：核心功能为模拟实现，缺少 FFmpeg 合成和节点透传
3. **数据库 schema**：1 个 Critical（users.created_at）会导致用户接口全部失败

建议按优先级分批修复，第一优先级的 4 项为阻塞项，必须在合并前修复。
