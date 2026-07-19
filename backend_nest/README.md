# AI Canvas Flow — 后端服务（NestJS 版）

基于 NestJS 的可视化 AI 视频创作工作流平台后端，提供用户认证、项目管理、工作流编辑、媒体资产、渲染任务、AI 配置、模板市场、快照恢复、协作邀请和实时协作等 API 服务。

本服务是 Python（FastAPI）后端的重构版本，**API 接口完全兼容**，可直接替换原后端运行。数据库 schema 复用 Python 版 Alembic 迁移，无需额外建表。

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Web 框架 | NestJS 10.4 | 模块化架构，TypeScript 原生 |
| ORM | TypeORM 0.3 + pg | PostgreSQL 异步访问 |
| 数据库 | PostgreSQL | 复用 Python 版 schema |
| 缓存 / 队列 | Redis + BullMQ 5.12 | BullMQ 替代 Celery，无需 RabbitMQ |
| 对象存储 | MinIO 8.0 | 媒体文件存储 |
| 实时通信 | Socket.IO 4.7 | WebSocket 协作编辑 |
| 认证 | @nestjs/jwt + passport-jwt | JWT Token + Refresh Token |
| DTO 验证 | class-validator + class-transformer | 全局 ValidationPipe |
| 视频处理 | fluent-ffmpeg | 时间轴合成导出 |
| 密码哈希 | bcryptjs | 兼容 Python bcrypt |
| 容器化 | Docker | 多阶段构建 |

## 项目结构

```
backend_nest/
├── src/
│   ├── main.ts                          # 应用入口（CORS / 全局前缀 / ValidationPipe / 异常过滤器）
│   ├── app.module.ts                    # 根模块（汇总所有子模块）
│   ├── common/                          # 公共基础设施
│   │   ├── config/                      # 环境变量配置（configuration.ts）
│   │   ├── database/                    # TypeORM 连接配置
│   │   ├── auth/                        # JWT 策略 / 守卫 / 可选 Token 守卫
│   │   ├── decorators/                  # @CurrentUser / @Public 装饰器
│   │   ├── filters/                     # FastApiCompatFilter（兼容 Python 错误格式）
│   │   ├── interceptors/                # 请求日志拦截器
│   │   └── utils/                       # MinioService
│   ├── modules/                         # 业务模块
│   │   ├── auth/                        # 认证（注册/登录/刷新/用户信息）
│   │   ├── projects/                    # 项目 CRUD + 封面上传
│   │   ├── workflows/                   # 工作流节点/边 + 批量保存
│   │   ├── media/                       # 媒体上传/下载/预签名/用量统计
│   │   ├── render/                      # 渲染任务创建/列表/取消/重试/导出
│   │   ├── ai/                          # AI Provider/Model CRUD + 工作流生成 + 字幕生成
│   │   ├── snapshots/                   # 项目快照 CRUD + 单事务恢复
│   │   ├── templates/                   # 模板市场列表/克隆/发布
│   │   ├── invitations/                 # 协作邀请 + 协作者管理
│   │   └── collaboration/              # 协作状态检查
│   ├── queue/                           # BullMQ 异步任务
│   │   ├── queue.module.ts             # 队列注册（render-tasks）
│   │   ├── queue.service.ts            # 入队 / 取消（discard + remove）
│   │   ├── render.processor.ts         # 任务处理器（AI/渲染/导出，并发 5）
│   │   └── export.service.ts           # FFmpeg 视频合成 + 上传
│   └── ws/                              # WebSocket 协作
│       ├── collaboration.gateway.ts     # Socket.IO 网关（afterInit 中间件鉴权）
│       ├── node-lock.service.ts         # 节点编辑锁
│       └── ws.module.ts
├── test/                                # 测试目录
│   ├── unit/                            # 单元测试（4 suites：auth/projects/snapshots/node-lock）
│   ├── integration/                     # 集成装配测试（boot.spec.ts，DI 容器装配验证）
│   └── e2e/                             # 端到端测试
├── Dockerfile                           # 多阶段构建（builder + production）
├── package.json
├── nest-cli.json
├── tsconfig.json
└── .env.example                         # 环境变量模板
```

## 快速开始

### 1. 安装依赖

```bash
cd backend_nest
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入数据库/Redis/MinIO + AI API Key 信息
```

> **复用 Python 后端配置**：可直接复制 `backend/.env`，`DATABASE_URL` 支持 `postgresql+asyncpg://` 前缀（代码自动转换为 `postgresql://`）。

### 3. 启动服务

```bash
# 开发模式（watch 热重载）
npm run start:dev

# 生产模式
npm run build && npm run start:prod
```

启动后访问：
- API 服务: http://localhost:8000
- 健康检查: http://localhost:8000/api/v1/status

> **无需独立 Worker 进程**：BullMQ 的 Processor 内嵌在应用进程中，启动后端即自动消费任务队列。与 Python 版需独立启动 Celery Worker 不同。

### 4. 数据库

NestJS 版本 `synchronize: false`，不自动建表。**复用 Python 版 Alembic 迁移**：

```bash
# 在 backend/ 目录执行（Python 版迁移）
cd ../backend
alembic upgrade head
```

## API 接口

所有接口前缀为 `/api/v1`。与 Python 版完全兼容，以下为完整端点清单。

### 认证 `/api/v1/auth`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/register` | 注册新用户（bcrypt 加密） |
| POST | `/auth/login` | 登录，返回 access_token + refresh_token |
| POST | `/auth/refresh` | 刷新 access_token（🆕 NestJS 新增） |
| GET | `/auth/me` | 获取当前用户信息 |
| PUT | `/auth/me` | 更新用户资料 |

### 项目 `/api/v1/projects`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 获取当前用户的项目列表 |
| POST | `/projects` | 创建新项目 |
| GET | `/projects/:id` | 获取项目详情 |
| PUT | `/projects/:id` | 更新项目 |
| DELETE | `/projects/:id` | 删除项目（级联删除 nodes/edges/snapshots/render_tasks/media_assets） |
| POST | `/projects/:id/cover` | 上传项目封面（🆕 NestJS 新增） |
| GET | `/projects/:id/cover/download` | 下载项目封面（🆕 NestJS 新增） |

### 工作流 `/api/v1/workflows`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/workflows/:id/nodes` | 获取工作流节点列表 |
| POST | `/workflows/:id/nodes` | 创建节点 |
| DELETE | `/workflows/:id/nodes/:nodeId` | 删除节点 + 关联边 |
| GET | `/workflows/:id/edges` | 获取工作流边列表 |
| POST | `/workflows/:id/edges` | 创建边 |
| DELETE | `/workflows/:id/edges/:edgeId` | 删除边 |
| PUT | `/workflows/:id/save` | 批量保存（全量替换节点/边） |

### 媒体资产 `/api/v1/media`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/media` | 获取媒体列表 |
| POST | `/media/upload` | 上传媒体文件（multipart → MinIO） |
| GET | `/media/stats/usage` | 媒体用量统计（🆕 NestJS 新增） |
| GET | `/media/:id` | 获取媒体详情 |
| GET | `/media/:id/presign` | 获取预签名下载 URL |
| GET | `/media/:id/download` | 后端代理下载文件 |
| DELETE | `/media/:id` | 删除媒体资产 |

### 渲染任务 `/api/v1/render`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/render` | 获取渲染任务列表（可按 status 筛选） |
| POST | `/render` | 创建渲染任务（入队 BullMQ，支持 node_id/model_id/prompt） |
| GET | `/render/:id` | 查询任务状态 |
| POST | `/render/:id/cancel` | 取消任务（discard + remove） |
| POST | `/render/:id/retry` | 重试任务（🆕 NestJS 新增） |
| POST | `/render/export` | 导出视频（FFmpeg 合成时间轴） |

### AI 配置 `/api/v1/ai`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET / POST | `/ai/providers` | Provider 列表 / 创建 |
| PUT / DELETE | `/ai/providers/:id` | Provider 更新 / 删除 |
| GET / POST | `/ai/models` | Model 列表（可按 type 筛选）/ 创建 |
| PUT / DELETE | `/ai/models/:id` | Model 更新 / 删除 |
| GET | `/ai/models/default` | 获取默认 AI 模型 |
| POST | `/ai/generate-workflow` | AI 生成工作流（mode: replace/append） |
| POST | `/ai/generate-subtitles` | AI 生成字幕（🆕 NestJS 新增） |

### 快照 `/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/projects/:id/snapshots` | 创建快照（auto 源受 5 条上限） |
| GET | `/projects/:id/snapshots` | 快照列表（可按 source 筛选） |
| GET | `/projects/:id/snapshots/latest` | 获取最新快照 |
| GET | `/snapshots/:id` | 快照详情 |
| DELETE | `/snapshots/:id` | 删除快照 |
| POST | `/snapshots/:id/restore` | 单事务恢复快照 |

### 模板市场 `/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/templates` | 模板列表（支持 q 搜索 + category 筛选） |
| POST | `/templates/:id/clone` | 克隆模板为新项目 |
| DELETE | `/templates/:id` | 取消模板发布 |
| POST | `/projects/:id/publish` | 发布项目为模板 |

### 协作邀请 `/api/v1`（🆕 NestJS 新增模块）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/projects/:id/invitations` | 创建协作邀请（生成 token） |
| GET | `/invitations/:token` | 查看邀请详情 |
| POST | `/invitations/:token/accept` | 接受邀请加入项目 |
| GET | `/projects/:id/collaborators` | 协作者列表 |
| PUT | `/projects/:id/collaborators/:userId` | 更新协作者角色（editor/viewer） |
| DELETE | `/projects/:id/collaborators/:userId` | 移除协作者 |

### 协作状态 `/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/status` | 协作服务状态检查 |

### WebSocket 协作 `/socket.io/`

| 事件 | 方向 | 说明 |
|------|------|------|
| `connect` | 客户端→服务端 | 建立连接（afterInit 中间件 JWT 鉴权，query string 传 token） |
| `disconnect` | 客户端→服务端 | 断开连接 |
| `join_project` | 双向 | 加入项目房间（ack 返回在线用户快照） |
| `leave_project` | 双向 | 离开项目房间 |
| `node_update` | 双向 | 节点变更广播（仅广播不写 DB） |
| `edge_update` | 双向 | 边变更广播（仅广播不写 DB） |
| `cursor_move` | 双向 | 远端光标移动 |
| `node_lock` / `node_unlock` | 双向 | 节点编辑锁（防止并发冲突） |
| `user_joined` / `user_left` | 服务端→客户端 | 房间成员变更广播 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/ai_canvas_flow` | 数据库连接（支持 asyncpg 前缀，自动转换） |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接（BullMQ broker + 结果存储） |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO 端点（支持 `host:port` 格式） |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO Access Key |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO Secret Key |
| `MINIO_BUCKET` | `ai-canvas-flow` | MinIO 桶名 |
| `MINIO_SECURE` | `false` | 是否 HTTPS |
| `SECRET_KEY` | `change-me-to-a-secure-random-string` | JWT 签名密钥 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access Token 过期时间（分钟） |
| `ALGORITHM` | `HS256` | JWT 算法 |
| `CORS_ORIGINS` | `["http://localhost:5173"..."http://localhost:5183"]` | CORS 允许来源（JSON 数组或逗号分隔） |
| `DEFAULT_AI_PROVIDER_NAME` | `火山引擎` | 默认 AI 服务商名称 |
| `DEFAULT_AI_PLATFORM` | `volcengine` | 默认平台 |
| `DEFAULT_AI_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` | 默认 API 基础 URL |
| `DEFAULT_AI_API_KEY` | （空） | 默认 AI API Key |
| `DEFAULT_AI_MODEL_ID` | `doubao-seed-2-1-turbo-260628` | 默认模型 ID |
| `DEFAULT_AI_MODEL_DISPLAY_NAME` | `豆包 Seed 2.1 Turbo` | 默认模型显示名 |
| `DEFAULT_AI_MODEL_TYPE` | `llm` | 默认模型类型 |
| `PORT` | `8000` | 服务端口 |

### 业务阈值（M15 抽离到 `limits` 配置段，可通过 .env 覆盖）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MEDIA_MAX_UPLOAD_SIZE_MB` | `100` | 单文件上传上限（MB），转字节存储 |
| `MEDIA_COVER_MAX_SIZE_MB` | `5` | 项目封面图上限（MB），转字节存储 |
| `INVITATION_DEFAULT_EXPIRES_HOURS` | `24` | 协作邀请默认过期时长（小时） |
| `INVITATION_MAX_COLLABORATORS` | `10` | 单项目协作者上限（不含 owner） |
| `SNAPSHOT_AUTO_MAX_COUNT` | `5` | auto 源快照保留上限（超出删最旧） |
| `PAGINATION_DEFAULT_LIMIT` | `50` | list 接口默认分页 limit |
| `PAGINATION_MAX_LIMIT` | `100` | list 接口最大分页 limit（防恶意拉全表） |

## Docker 部署

```bash
# 构建镜像（多阶段：builder 编译 + production 运行）
docker build -t ai-canvas-flow-backend-nest ./backend_nest

# 运行容器
docker run -d \
  --name ai-canvas-flow-backend-nest \
  -p 8000:8000 \
  --env-file backend_nest/.env \
  ai-canvas-flow-backend-nest
```

> Dockerfile 基于 `node:20-slim`，内置 `ffmpeg`（视频导出依赖）。

## 与 Python 后端的差异

| 维度 | Python 版 (backend/) | NestJS 版 (backend_nest/) |
|------|----------------------|---------------------------|
| 框架 | FastAPI | NestJS 10.4 |
| ORM | SQLAlchemy 2.0 async | TypeORM 0.3 |
| 任务队列 | Celery + RabbitMQ | BullMQ + Redis（无需 RabbitMQ） |
| 迁移 | Alembic | 复用 Python Alembic（`synchronize: false`） |
| Worker | 独立进程 `celery worker` | 内嵌应用进程（Processor 自动消费） |
| WebSocket | python-socketio (ASGI 挂载) | @nestjs/platform-socket.io (IoAdapter) |
| 密码哈希 | bcrypt (passlib) | bcryptjs（兼容） |
| 错误格式 | FastAPI 默认 | FastApiCompatFilter 兼容 |
| API 文档 | /docs (OpenAPI 自动) | 无（手动文档见本 README） |
| 健康检查 | ❌ 无 | ✅ GET /status（含 DB 依赖状态） |
| 业务端点 | invitations/refresh/retry/stats/subtitles 全实现 | 同左（API 完全等价） |

## 开发注意事项

- **数据库 schema**：`synchronize: false`，禁止自动建表。schema 变更必须通过 Python Alembic 迁移。
- **DATABASE_URL 兼容**：`configuration.ts` 自动将 `postgresql+asyncpg://` 转为 `postgresql://`，可直接复用 Python `.env`。
- **MinIO endpoint**：`minio.service.ts` 的 `onModuleInit` 自动解析 `host:port` 格式，兼容 Python `.env` 写法。
- **ValidationPipe**：`whitelist: true` 会移除无 class-validator 装饰器的 DTO 属性，DTO 字段必须加装饰器（如 `@IsArray()`）。
- **WebSocket 鉴权**：使用 `OnGatewayInit.afterInit` + `server.use` 中间件鉴权（非 `handleConnection`），避免 async 竞态导致 `client.data.userId` 未设置。
- **任务取消**：BullMQ 5.x 的 `discard()` 仅设置本地标志，跨实例不可见。通过 `job.getState() === 'unknown'` 检测任务被 `remove()` 后的状态，实现"终止运行中任务"语义。
- **时间戳填充**：entity 已加 `default: () => 'NOW()'` 声明，DB 层通过 `ALTER TABLE ... SET DEFAULT NOW()` 补齐默认值。INSERT 时 TypeORM 用 `DEFAULT` 关键字由 DB 填充 `createdAt/updatedAt`，应用层无需手动设置。
- **协作变更不写 DB**：`node_update`/`edge_update`/`cursor_move` 仅广播，持久化依赖前端 autoSaveStore 双防抖快照。
- **项目删除**：级联删除 workflow_nodes/edges/snapshots/render_tasks/media_assets，避免外键约束错误。
- **进度值**：`render_tasks.progress` 为 0-100 整数，前端直接展示。
- **默认 AI 配置**：首次启动自动初始化默认 Provider/Model（从 `DEFAULT_AI_*` 环境变量读取）。
- **AI 任务路由**：`ai_*` 前缀走 AI 推理（text2img 走 Images API，text2video 走视频 API，tts 走音频 API），无前缀走模拟渲染，`export` 走 FFmpeg 合成。

## 测试

```bash
# 单元测试 + 集成装配测试（一起跑，无需启动服务）
npm test

# E2E 测试（需先启动服务）
npm run test:e2e

# watch 模式
npm run test:watch
```

**测试目录结构：**

| 目录 | 内容 | 当前用例数 |
|------|------|-----------|
| `test/unit/` | 业务 service 单元测试（mock 依赖） | 4 suites / 50 tests（auth/projects/snapshots/node-lock） |
| `test/integration/` | 集成装配测试（`boot.spec.ts`，import 完整 AppModule 验证 DI 容器装配 + M14/M15 配置加载） | 1 suite / 17 tests |
| `test/e2e/` | 端到端 HTTP 测试（supertest，需启动服务） | 1 suite |

**当前状态：** 5 suites / 68 tests 全部通过，外加 20 项端到端冒烟测试（覆盖注册/登录/项目/workflow/快照/渲染/M12 pending 验证/M3 DTO 校验/导出/级联删除）。