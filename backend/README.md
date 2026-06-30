# AI Canvas Flow — 后端服务

基于 FastAPI 的可视化 AI 视频创作工作流平台后端，提供用户认证、项目管理、媒体资产、渲染任务、工作流编辑、AI 配置、AI 工作流生成、模板市场、快照恢复和实时协作等 API 服务。

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Web 框架 | FastAPI 0.115 | 异步 API，自动 OpenAPI 文档 |
| 数据库 | PostgreSQL + asyncpg | SQLAlchemy 2.0 异步 ORM |
| 缓存 | Redis | 会话/速率限制/Celery 结果后端 |
| 对象存储 | MinIO | 媒体文件存储 |
| 任务队列 | Celery + RabbitMQ | 异步渲染/AI 推理任务（RabbitMQ 4.x 兼容） |
| 实时通信 | python-socketio | WebSocket 协作编辑 |
| 认证 | JWT (python-jose + bcrypt) | Token 鉴权 |
| 数据库迁移 | Alembic | 异步迁移支持 |

## 项目结构

```
backend/
├── app/
│   ├── main.py              # 应用入口、CORS、生命周期、Socket.IO 挂载
│   ├── config.py             # Pydantic Settings 环境变量配置
│   ├── database.py           # SQLAlchemy 异步引擎 + 会话工厂
│   ├── deps.py               # 依赖注入（DB 会话、当前用户）
│   ├── api/                  # API 路由层
│   │   ├── router.py         # 路由汇总，统一 /api/v1 前缀
│   │   ├── auth.py           # 认证：注册/登录/获取用户/更新资料
│   │   ├── projects.py       # 项目 CRUD（含级联删除）
│   │   ├── workflows.py      # 工作流节点/边操作 + 批量保存
│   │   ├── media.py          # 媒体上传/下载/预签名 URL
│   │   ├── render.py         # 渲染任务创建/列表/查询/取消
│   │   ├── ai.py             # AI Provider/Model CRUD + 工作流生成
│   │   ├── snapshots.py      # 项目快照 CRUD + 单事务恢复
│   │   ├── templates.py      # 模板市场列表/克隆/发布/取消发布
│   │   └── collaboration.py  # 协作状态检查（实际协作走 Socket.IO）
│   ├── models/               # SQLAlchemy ORM 模型
│   │   ├── user.py           # User（用户）
│   │   ├── project.py        # Project（项目，含模板字段）
│   │   ├── media_asset.py    # MediaAsset（媒体资产）
│   │   ├── render_task.py    # RenderTask（渲染任务，含 node_id）
│   │   ├── workflow.py       # WorkflowNode / WorkflowEdge
│   │   ├── ai_provider.py    # AiProvider（AI 服务商）
│   │   ├── ai_model.py       # AiModel（AI 模型）
│   │   └── project_snapshot.py  # ProjectSnapshot（项目快照）
│   ├── schemas/              # Pydantic 请求/响应模型
│   ├── services/             # 业务逻辑层
│   │   ├── auth_service.py   # 密码哈希/JWT
│   │   ├── project_service.py  # 项目业务逻辑
│   │   ├── media_service.py  # MinIO 文件操作
│   │   ├── render_service.py  # 渲染任务提交/取消
│   │   ├── ai_service.py     # AI 调用 + 工作流生成
│   │   └── workflow_engine.py  # 工作流 DAG 执行引擎（LangGraph）
│   ├── tasks/                # Celery 异步任务
│   │   ├── celery_app.py     # Celery 实例配置
│   │   ├── render_tasks.py   # 渲染/AI 推理任务（run_render_task）
│   │   └── ai_tasks.py       # AI 通用任务（run_ai_task）
│   └── ws/
│       └── collaboration.py  # Socket.IO 协作事件处理
├── alembic/                  # 数据库迁移脚本
├── alembic.ini               # Alembic 配置
├── tests/                    # 单元测试
├── Dockerfile                # 多阶段构建镜像
├── requirements.txt          # Python 依赖
└── .env.example              # 环境变量模板
```

## 快速开始

### 1. 环境准备

```bash
# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入实际的数据库/Redis/MinIO/RabbitMQ + AI API Key 信息
```

### 3. 启动服务

```bash
# 开发模式（自动重载 + 自动建表 + 自动初始化默认 AI 配置）
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 生产模式
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

启动后访问：
- API 文档: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health

### 4. 数据库迁移

```bash
# 生成迁移脚本
alembic revision --autogenerate -m "描述"

# 执行迁移
alembic upgrade head
```

> 开发模式下 `main.py` 的 `lifespan` 会自动执行 `Base.metadata.create_all`，无需手动迁移即可建表。

## API 接口

所有接口前缀为 `/api/v1`，完整文档见 `/docs`。

### 认证 `/api/v1/auth`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/register` | 注册新用户（用户名/邮箱唯一校验，bcrypt 加密） |
| POST | `/auth/login` | 登录，返回 access_token + refresh_token（JWT，7 天） |
| GET | `/auth/me` | 获取当前用户信息（需 Token） |
| PUT | `/auth/me` | 更新当前用户资料（username/email/avatar_url，含唯一性校验） |

### 项目 `/api/v1/projects`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/` | 获取当前用户的项目列表 |
| POST | `/projects/` | 创建新项目 |
| GET | `/projects/{id}` | 获取项目详情 |
| PUT | `/projects/{id}` | 更新项目（部分更新） |
| DELETE | `/projects/{id}` | 删除项目（级联删除 workflow_nodes/edges/snapshots/render_tasks/media_assets） |

### 工作流 `/api/v1/workflows`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/workflows/{id}/nodes` | 获取工作流节点列表 |
| POST | `/workflows/{id}/nodes` | 创建节点 |
| DELETE | `/workflows/{id}/nodes/{node_id}` | 删除节点 + 关联边 |
| GET | `/workflows/{id}/edges` | 获取工作流边列表 |
| POST | `/workflows/{id}/edges` | 创建边 |
| DELETE | `/workflows/{id}/edges/{edge_id}` | 删除边 |
| PUT | `/workflows/{id}/save` | 批量保存（全量替换节点/边） |

### 媒体资产 `/api/v1/media`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/media/` | 获取当前用户的媒体列表 |
| POST | `/media/upload` | 上传媒体文件（multipart/form-data → MinIO） |
| GET | `/media/{id}` | 获取媒体详情 |
| GET | `/media/{id}/presign` | 获取预签名下载 URL（1 小时有效） |
| GET | `/media/{id}/download` | 后端代理下载文件（解决跨域） |
| DELETE | `/media/{id}` | 删除媒体资产（MinIO + DB） |

### 渲染任务 `/api/v1/render`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/render/` | 获取渲染任务列表（可按 status 筛选） |
| POST | `/render/` | 创建渲染任务（触发 Celery，支持 node_id/model_id/prompt/input_artifacts） |
| GET | `/render/{id}` | 查询渲染任务状态（返回 node_label/project_name） |
| POST | `/render/{id}/cancel` | 取消渲染任务（AsyncResult.revoke(terminate=True)） |

### AI 配置 `/api/v1/ai`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET / POST | `/ai/providers` | AI Provider 列表 / 创建 |
| PUT / DELETE | `/ai/providers/{id}` | AI Provider 更新 / 删除 |
| GET / POST | `/ai/models` | AI Model 列表（可按 type 筛选） / 创建 |
| PUT / DELETE | `/ai/models/{id}` | AI Model 更新 / 删除 |
| GET | `/ai/models/default` | 获取默认 AI 模型（AI 推理节点自动选模型） |
| POST | `/ai/generate-workflow` | AI 快速生成工作流（mode: replace/append，LLM 解析描述生成节点/边） |

### 快照 `/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/projects/{id}/snapshots` | 创建快照（auto 源受 5 条上限） |
| GET | `/projects/{id}/snapshots` | 快照列表（可按 source 筛选） |
| GET | `/projects/{id}/snapshots/latest` | 获取最新快照 |
| GET | `/snapshots/{id}` | 快照详情 |
| DELETE | `/snapshots/{id}` | 删除快照 |
| POST | `/snapshots/{id}/restore` | 单事务恢复快照到 nodes/edges |

### 模板市场 `/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/templates/` | 模板列表（支持 q 搜索 + category 筛选） |
| POST | `/templates/{id}/clone` | 克隆模板为新项目（复制 nodes/edges，ID 加前缀） |
| POST | `/projects/{id}/publish` | 发布项目为模板（category + tags） |
| DELETE | `/templates/{id}` | 取消模板发布（仅 owner） |

### 协作 `/api/v1/collab`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/collab/status` | 协作服务状态检查（实际协作走 Socket.IO `/socket.io/`） |

### WebSocket 协作 `/socket.io/`

| 事件 | 方向 | 说明 |
|------|------|------|
| `connect` | 客户端→服务端 | 建立连接（JWT 鉴权，query string 传 token） |
| `disconnect` | 客户端→服务端 | 断开连接 |
| `join_project` | 双向 | 加入项目协作房间（ack 返回在线用户快照） |
| `leave_project` | 双向 | 离开项目协作房间 |
| `node_update` | 双向 | 节点变更广播（仅广播不写 DB） |
| `edge_update` | 双向 | 边变更广播（仅广播不写 DB） |
| `cursor_move` | 双向 | 远端光标移动（自包含 user_id/username + sid） |
| `user_joined/user_left` | 服务端→客户端 | 房间成员变更广播 |
| `ping/pong` | 双向 | 心跳/延迟检测 |

## 数据库模型

### ER 关系

```
users
  ├──< projects (owner_id)
  │       ├──< media_assets (project_id)
  │       ├──< render_tasks (project_id, node_id)
  │       ├──< workflow_nodes (project_id)
  │       │       └──< workflow_edges (source_node_id / target_node_id)
  │       ├──< workflow_edges (project_id)
  │       └──< project_snapshots (project_id, source=auto/manual)
  ├──< media_assets (owner_id)
  └──< render_tasks (owner_id)

ai_providers
  └──< ai_models (provider_id)
```

### 表字段

**users** — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| username | VARCHAR(64) UNIQUE | 用户名 |
| email | VARCHAR(255) UNIQUE | 邮箱 |
| hashed_password | VARCHAR(255) | bcrypt 哈希密码 |
| avatar_url | VARCHAR(512) | 头像 URL |
| created_at | TIMESTAMP | 创建时间 |

**projects** — 项目表（含模板字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| name | VARCHAR(128) | 项目名称 |
| description | TEXT | 项目描述 |
| cover_url | VARCHAR(512) | 封面 URL |
| owner_id | UUID FK→users | 所有者 |
| is_template | BOOLEAN | 是否为模板 |
| template_category | VARCHAR(64) | 模板分类 |
| template_tags | JSON | 模板标签 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**media_assets** — 媒体资产表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| owner_id | UUID FK→users | 所有者 |
| project_id | UUID FK→projects | 关联项目 |
| file_name | VARCHAR(256) | 文件名 |
| file_type | VARCHAR(128) | MIME 类型 |
| file_size | INTEGER | 文件大小（字节） |
| storage_key | VARCHAR(512) | MinIO 存储路径 |
| thumbnail_key | VARCHAR(512) | 缩略图路径 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**render_tasks** — 渲染任务表（含 node_id）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| project_id | UUID FK→projects | 关联项目 |
| owner_id | UUID FK→users | 所有者 |
| node_id | VARCHAR(128) | 关联工作流节点 ID（可空） |
| task_type | VARCHAR(64) | 任务类型（render/ai_text2img/ai_img2video/ai_tts/ai_llm） |
| status | VARCHAR(32) | 状态（pending/running/completed/failed/cancelled） |
| progress | INTEGER | 进度 0-100（整数，非 0.0-1.0） |
| celery_task_id | VARCHAR(256) | Celery 任务 ID |
| model_id | UUID FK→ai_models | 使用的 AI 模型（可空） |
| prompt | TEXT | 提示词（可空） |
| input_artifacts | JSON | 输入产物 |
| result_url | VARCHAR(512) | 结果文件 URL |
| error_message | TEXT | 错误信息 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**workflow_nodes** — 工作流节点表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(128) PK | 主键（字符串，兼容 ReactFlow） |
| project_id | UUID FK→projects | 关联项目 |
| node_type | VARCHAR(64) | 节点类型（input/ai_inference/processing/control/output） |
| label | VARCHAR(128) | 节点标签 |
| position_x | FLOAT | X 坐标 |
| position_y | FLOAT | Y 坐标 |
| config | JSON | 节点配置（params） |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**workflow_edges** — 工作流边表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(128) PK | 主键（字符串，兼容 ReactFlow） |
| project_id | UUID FK→projects | 关联项目 |
| source_node_id | VARCHAR(128) FK→workflow_nodes | 源节点 |
| target_node_id | VARCHAR(128) FK→workflow_nodes | 目标节点 |
| source_port | VARCHAR(64) | 源端口 |
| target_port | VARCHAR(64) | 目标端口 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**ai_providers** — AI 服务商表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| name | VARCHAR(128) | 服务商名称 |
| platform | VARCHAR(64) | 平台（volcengine/openai/custom） |
| base_url | VARCHAR(512) | API 基础 URL |
| api_key | VARCHAR(512) | API Key（明文存储，生产建议加密） |
| is_active | BOOLEAN | 是否启用 |
| created_at | TIMESTAMP | 创建时间 |

**ai_models** — AI 模型表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| provider_id | UUID FK→ai_providers | 所属服务商 |
| model_id | VARCHAR(128) | 平台模型标识（如 doubao-seed-2-1-turbo-260628） |
| display_name | VARCHAR(128) | 显示名称 |
| model_type | VARCHAR(32) | 类型（llm/image_gen/video_gen/tts） |
| is_active | BOOLEAN | 是否启用 |
| created_at | TIMESTAMP | 创建时间 |

**project_snapshots** — 项目快照表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| project_id | UUID FK→projects | 关联项目 |
| snapshot_data | JSONB | 快照数据（nodes/edges/timelineData） |
| source | VARCHAR(32) | 来源（auto/manual，auto 受 5 条上限） |
| label | VARCHAR(128) | 标签（manual 快照命名） |
| created_at | TIMESTAMP | 创建时间 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROJECT_NAME` | ai-canvas-flow-backend | 项目名称 |
| `VERSION` | 0.1.0 | 版本号 |
| `DEBUG` | false | 调试模式 |
| `DATABASE_URL` | postgresql+asyncpg://postgres:postgres@localhost:5432/ai_canvas_flow | 数据库连接 |
| `REDIS_URL` | redis://localhost:6379/0 | Redis 连接 |
| `MINIO_ENDPOINT` | localhost:9000 | MinIO 端点 |
| `MINIO_ACCESS_KEY` | minioadmin | MinIO Access Key |
| `MINIO_SECRET_KEY` | minioadmin | MinIO Secret Key |
| `MINIO_BUCKET` | ai-canvas-flow | MinIO 桶名 |
| `MINIO_SECURE` | false | 是否 HTTPS |
| `SECRET_KEY` | change-me-to-a-secure-random-string | JWT 签名密钥 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 30 | Token 过期时间（分钟） |
| `ALGORITHM` | HS256 | JWT 算法 |
| `CELERY_BROKER_URL` | amqp://guest:guest@localhost:5672// | RabbitMQ Broker |
| `CELERY_RESULT_BACKEND` | redis://localhost:6379/1 | Celery 结果后端 |
| `CORS_ORIGINS` | ["http://localhost:5173"..."http://localhost:5183"] | CORS 允许来源（覆盖 Vite 端口范围） |
| `DEFAULT_AI_PROVIDER_NAME` | 火山引擎 | 默认 AI 服务商名称（首次启动自动创建） |
| `DEFAULT_AI_PLATFORM` | volcengine | 默认平台 |
| `DEFAULT_AI_BASE_URL` | https://ark.cn-beijing.volces.com/api/v3 | 默认 API 基础 URL |
| `DEFAULT_AI_API_KEY` | （空） | 默认 AI API Key（需填入实际 Key） |
| `DEFAULT_AI_MODEL_ID` | doubao-seed-2-1-turbo-260628 | 默认模型 ID |
| `DEFAULT_AI_MODEL_DISPLAY_NAME` | 豆包 Seed 2.1 Turbo | 默认模型显示名 |
| `DEFAULT_AI_MODEL_TYPE` | llm | 默认模型类型 |

## Docker 部署

```bash
# 构建镜像
docker build -t ai-canvas-flow-backend .

# 运行容器
docker run -d \
  --name ai-canvas-flow-backend \
  -p 8000:8000 \
  --env-file .env \
  ai-canvas-flow-backend
```

## Celery Worker

```bash
# 启动 Worker（渲染 + AI 推理任务）
celery -A app.tasks.celery_app worker --loglevel=info --pool=solo \
  --without-mingle --without-gossip --without-heartbeat
```

> 注意：RabbitMQ 4.x 兼容性需要 `--without-mingle --without-gossip --without-heartbeat` 参数。

## 开发注意事项

- **密码哈希**: 使用 `bcrypt` 直接哈希（非 passlib），兼容 Python 3.13
- **时区**: ORM 模型使用 `TIMESTAMP WITHOUT TIME ZONE`，代码中必须用 `datetime.utcnow()` 而非 `datetime.now(timezone.utc)`
- **Socket.IO 挂载**: 使用 `ASGIApp(sio, other_asgi_app=app)` 共存模式，Socket.IO 走 `/socket.io/` 路径
- **Socket.IO 鉴权**: connect 事件从 query string 解析 JWT token 验证（避免 CORS preflight + 适配 Socket.IO 协议）
- **协作变更不写 DB**: `node_update`/`edge_update`/`cursor_move` 仅广播，持久化依赖前端 autoSaveStore 双防抖快照
- **项目删除**: 级联删除 workflow_nodes/edges/snapshots/render_tasks/media_assets，避免外键约束错误
- **进度值存储**: `render_tasks.progress` 为 0-100 整数（非 0.0-1.0），前端直接展示
- **Celery 任务事件循环**: 必须创建 Celery 专用 async engine + session factory + 事件循环（不能复用 FastAPI 的，避免 `Future attached to a different loop`）
- **Celery 任务发现**: `__init__.py` 必须显式导入任务模块（autodiscover 可能失败）
- **工作流保存顺序**: 先 flush 节点再插边，避免 `workflow_edges_target_node_id_fkey` 外键冲突
- **AI 任务路由**: `ai_*` 前缀走 AI 推理（`ai_text2img` 走 Images API，其他走 Chat Completions API），无前缀走模拟渲染
- **默认 AI 配置**: 首次启动 `lifespan` 自动调用 `ensure_default_ai_config` 初始化 Provider/Model
- **开发模式**: 无 Token 时 `get_current_user` 返回默认用户 `"user-dev"`，生产环境需移除此回退
