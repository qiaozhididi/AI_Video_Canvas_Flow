# AI Canvas Flow — 后端服务

基于 FastAPI 的可视化 AI 视频创作工作流平台后端，提供用户认证、项目管理、媒体资产、渲染任务、工作流编辑和实时协作等 API 服务。

## 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Web 框架 | FastAPI 0.115 | 异步 API，自动 OpenAPI 文档 |
| 数据库 | PostgreSQL + asyncpg | SQLAlchemy 2.0 异步 ORM |
| 缓存 | Redis | 会话/速率限制 |
| 对象存储 | MinIO | 媒体文件存储 |
| 任务队列 | Celery + RabbitMQ | 异步渲染/AI 推理任务 |
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
│   │   ├── auth.py           # 认证：注册/登录/获取用户
│   │   ├── projects.py       # 项目 CRUD（含级联删除）
│   │   ├── media.py          # 媒体上传/下载/预签名 URL
│   │   ├── render.py         # 渲染任务创建/查询/取消
│   │   ├── workflows.py      # 工作流节点/边操作（TODO）
│   │   └── collaboration.py  # 协作状态检查
│   ├── models/               # SQLAlchemy ORM 模型
│   │   ├── user.py           # User（用户）
│   │   ├── project.py        # Project（项目）
│   │   ├── media_asset.py    # MediaAsset（媒体资产）
│   │   ├── render_task.py    # RenderTask（渲染任务）
│   │   └── workflow.py       # WorkflowNode / WorkflowEdge
│   ├── schemas/              # Pydantic 请求/响应模型
│   ├── services/             # 业务逻辑层
│   ├── tasks/                # Celery 异步任务
│   │   ├── celery_app.py     # Celery 实例配置
│   │   ├── render_tasks.py   # 渲染任务
│   │   └── ai_tasks.py       # AI 推理任务
│   └── ws/
│       └── collaboration.py  # Socket.IO 协作事件处理
├── alembic/                  # 数据库迁移脚本
├── alembic.ini               # Alembic 配置
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
# 编辑 .env，填入实际的数据库/Redis/MinIO/RabbitMQ 连接信息
```

### 3. 启动服务

```bash
# 开发模式（自动重载 + 自动建表）
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
| POST | `/auth/register` | 注册新用户 |
| POST | `/auth/login` | 登录，返回 JWT Token |
| GET | `/auth/me` | 获取当前用户信息（需 Token） |

**请求示例：**

```bash
# 注册
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"Test1234!"}'

# 登录
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"Test1234!"}'

# 获取用户信息
curl http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer <access_token>"
```

### 项目 `/api/v1/projects`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/` | 获取当前用户的项目列表 |
| POST | `/projects/` | 创建新项目 |
| GET | `/projects/{id}` | 获取项目详情 |
| PUT | `/projects/{id}` | 更新项目（部分更新） |
| DELETE | `/projects/{id}` | 删除项目（级联删除关联的渲染任务和媒体资产） |

### 媒体资产 `/api/v1/media`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/media/` | 获取当前用户的媒体列表 |
| POST | `/media/upload` | 上传媒体文件（multipart/form-data） |
| GET | `/media/{id}` | 获取媒体详情 |
| GET | `/media/{id}/presign` | 获取预签名下载 URL |
| DELETE | `/media/{id}` | 删除媒体资产 |

### 渲染任务 `/api/v1/render`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/render/` | 创建渲染任务 |
| GET | `/render/{id}` | 查询渲染任务状态 |
| POST | `/render/{id}/cancel` | 取消渲染任务 |

### 工作流 `/api/v1/workflows`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/workflows/{id}/nodes` | 获取工作流节点 |
| POST | `/workflows/{id}/nodes` | 创建节点 |
| DELETE | `/workflows/{id}/nodes/{node_id}` | 删除节点 |
| GET | `/workflows/{id}/edges` | 获取工作流边 |
| POST | `/workflows/{id}/edges` | 创建边 |
| DELETE | `/workflows/{id}/edges/{edge_id}` | 删除边 |

### 协作 `/api/v1/collab`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/collab/status` | 协作服务状态 |

### WebSocket 协作 `/socket.io/`

| 事件 | 方向 | 说明 |
|------|------|------|
| `connect` | 客户端→服务端 | 建立连接 |
| `disconnect` | 客户端→服务端 | 断开连接 |
| `join_project` | 双向 | 加入项目协作房间 |
| `leave_project` | 双向 | 离开项目协作房间 |
| `node_update` | 双向 | 节点变更广播 |
| `edge_update` | 双向 | 边变更广播 |
| `cursor_move` | 双向 | 远端光标移动 |
| `ping/pong` | 双向 | 心跳/延迟检测 |

## 数据库模型

### ER 关系

```
users
  ├──< projects (owner_id)
  │       ├──< media_assets (project_id)
  │       ├──< render_tasks (project_id)
  │       ├──< workflow_nodes (project_id)
  │       │       └──< workflow_edges (source_node_id / target_node_id)
  │       └──< workflow_edges (project_id)
  ├──< media_assets (owner_id)
  └──< render_tasks (owner_id)
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

**projects** — 项目表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| name | VARCHAR(128) | 项目名称 |
| description | TEXT | 项目描述 |
| cover_url | VARCHAR(512) | 封面 URL |
| owner_id | UUID FK→users | 所有者 |
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

**render_tasks** — 渲染任务表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| project_id | UUID FK→projects | 关联项目 |
| owner_id | UUID FK→users | 所有者 |
| task_type | VARCHAR(64) | 任务类型（render/text2img/img2video/tts） |
| status | VARCHAR(32) | 状态（pending/running/completed/failed/cancelled） |
| progress | FLOAT | 进度 0.0~1.0 |
| celery_task_id | VARCHAR(256) | Celery 任务 ID |
| result_url | VARCHAR(512) | 结果文件 URL |
| error_message | TEXT | 错误信息 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**workflow_nodes** — 工作流节点表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| project_id | UUID FK→projects | 关联项目 |
| node_type | VARCHAR(64) | 节点类型 |
| label | VARCHAR(128) | 节点标签 |
| position_x | FLOAT | X 坐标 |
| position_y | FLOAT | Y 坐标 |
| config | JSON | 节点配置 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**workflow_edges** — 工作流边表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| project_id | UUID FK→projects | 关联项目 |
| source_node_id | UUID FK→workflow_nodes | 源节点 |
| target_node_id | UUID FK→workflow_nodes | 目标节点 |
| source_port | VARCHAR(64) | 源端口 |
| target_port | VARCHAR(64) | 目标端口 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

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
| `CORS_ORIGINS` | ["http://localhost:5173"] | CORS 允许来源 |

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
# 启动渲染任务 Worker
celery -A app.tasks.celery_app worker --loglevel=info -Q render

# 启动 AI 推理任务 Worker
celery -A app.tasks.celery_app worker --loglevel=info -Q ai
```

## 开发注意事项

- **密码哈希**: 使用 `bcrypt` 直接哈希（非 passlib），兼容 Python 3.13
- **时区**: ORM 模型使用 `TIMESTAMP WITHOUT TIME ZONE`，代码中必须用 `datetime.utcnow()` 而非 `datetime.now(timezone.utc)`
- **Socket.IO 挂载**: 使用 `ASGIApp(sio, other_asgi_app=app)` 共存模式，Socket.IO 走 `/socket.io/` 路径
- **项目删除**: 级联删除关联的 `render_tasks` 和 `media_assets`，避免外键约束错误
- **开发模式**: 无 Token 时 `get_current_user` 返回默认用户 `"user-dev"`，生产环境需移除此回退
