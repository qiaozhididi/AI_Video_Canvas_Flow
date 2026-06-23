# AI Canvas Flow — 后端开发技术文档

## 1. 项目概述

AI Canvas Flow 后端定位为 **AI 算力网关 + 工作流状态机 + 媒体处理调度中心**，承担三大核心职责：

- **AI 算力网关**：统一对接文生图（Stable Diffusion）、图生视频（Kling/Runway）、语音合成（CosyVoice）等外部 AI 模型 API，屏蔽模型差异，提供标准化推理接口
- **工作流状态机**：基于 LangGraph 将前端画布拓扑 JSON 解析为 DAG 状态机，管理节点依赖解析、并行调度、失败重试与断点续执行
- **媒体处理调度中心**：通过 Celery 异步队列调度 GPU Worker 执行 FFmpeg 重度视频合成，结合 MinIO 对象存储管理全链路媒体资产

后端与前端通过 HTTP REST API + WebSocket 双通道交互：REST 负责项目 CRUD、素材管理等请求-响应式操作，WebSocket 负责工作流执行进度推送与协作编辑实时同步。

## 2. 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 语言 | Python | 3.12+ | 后端开发语言 |
| Web 框架 | FastAPI | 0.110+ | 异步 API 网关，请求路由、鉴权、WebSocket |
| ASGI 服务器 | Uvicorn | 0.30+ | 高性能异步服务器 |
| 数据校验 | Pydantic | 2.x | 请求/响应数据校验与序列化 |
| AI 编排 | LangChain | 0.2+ | AI 模型调用编排（LLM/SD/Video/TTS） |
| 工作流引擎 | LangGraph | 0.2+ | DAG 状态机，节点依赖解析与执行调度 |
| 任务队列 | Celery | 5.4+ | 异步任务分发与执行 |
| 消息代理 | RabbitMQ | 3.13+ | 高可靠任务分发队列 |
| 缓存 | Redis | 7+ | 消息代理（Broker）+ 状态缓存 + Pub/Sub |
| 数据库 | PostgreSQL | 16+ | 工作流元数据、用户信息、项目数据 |
| ORM | SQLAlchemy | 2.0+ | 异步 ORM，数据库模型与查询 |
| 数据库迁移 | Alembic | 1.13+ | 数据库 Schema 版本管理 |
| 对象存储 | MinIO | latest | S3 兼容对象存储，音视频/图片资产 |
| 实时通信 | python-socketio | 5+ | WebSocket 服务端，实时进度推送与协作 |
| 视频处理 | python-ffmpeg | 2+ | 后端原生 FFmpeg 调用，GPU 加速视频合成 |
| 容器化 | Docker | 24+ | 服务容器化 |
| 编排 | Docker Compose | 2.20+ | 多服务本地编排 |
| JWT | PyJWT | 2.8+ | 双 Token 认证方案 |
| 密码哈希 | passlib[bcrypt] | 1.7+ | 用户密码安全哈希 |

## 3. 项目架构

### 3.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    React Frontend                           │  │
│  │    React Flow  │  Video.js  │  Zustand  │  Socket.IO      │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────────┘
                          │
               ┌──────────┴──────────┐
               │   HTTP REST API     │
               │   WebSocket (SIO)   │
               └──────────┬──────────┘
                          │
┌─────────────────────────┼─────────────────────────────────────────┐
│                    Backend (Python)                                │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     API 层                                │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │    │
│  │  │  Auth    │  │ Project  │  │  Media   │  │ Render  │  │    │
│  │  │  Router  │  │  Router  │  │  Router  │  │ Router  │  │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │    │
│  └───────┼──────────────┼──────────────┼──────────────┼──────┘    │
│          │              │              │              │            │
│  ┌───────┴──────────────┴──────────────┴──────────────┴──────┐    │
│  │                     Service 层                            │    │
│  │  AuthService │ ProjectService │ MediaService │ RenderSvc │    │
│  │              │ WorkflowService │ CollabService│           │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                              │                                    │
│  ┌──────────────────────────┴───────────────────────────────┐    │
│  │                   AI 编排层                               │    │
│  │  DAGParser ──> LangGraphEngine ──> AIAgent               │    │
│  │     │                │                    │               │    │
│  │     │          状态机执行           模型调用编排           │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                              │                                    │
│  ┌──────────────────────────┴───────────────────────────────┐    │
│  │                   任务层 (Celery)                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐               │    │
│  │  │AI Worker │  │Render    │  │  TTS     │               │    │
│  │  │(SD/Video)│  │Worker    │  │  Worker  │               │    │
│  │  └──────────┘  └──────────┘  └──────────┘               │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   数据层                                  │    │
│  │  PostgreSQL  │  MinIO  │  Redis                           │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │    External AI APIs     │
              │  SD │ Kling │ CosyVoice│
              └────────────────────────┘
```

### 3.2 数据流

```
[前端 React Flow] ──(1. 导出拓扑 JSON)──> [FastAPI 网关]
                                               │
                                       (2. DAG Parser 解析拓扑)
                                               │
                                       (3. LangGraph 构建状态机)
                                               │
[Celery 队列] <──(4. 按依赖分发任务)── [LangGraph Engine]
      │
      ├──> 任务 A (文生图): 调用 SD API -> 结果存 MinIO -> 更新状态(25%)
      ├──> 任务 B (图生视频): 读取 MinIO 图片 -> 调用 Kling API -> 存 MinIO -> 更新状态(60%)
      └──> 任务 C (FFmpeg 合成): 下载视频+BGM -> GPU 混流 -> 最终 MP4 -> 更新状态(100%)
                                               │
                                       (5. Redis Pub/Sub 通知)
                                               │
                                       (6. WebSocket 推送进度)
                                               │
[前端 Video.js] <──(7. HLS 流式播放)── [用户端屏幕]
```

## 4. 目录结构

```
backend/
├── app/
│   ├── main.py                      # FastAPI 应用入口，注册路由、中间件、生命周期
│   ├── config.py                    # 配置管理，读取环境变量，Pydantic Settings
│   ├── deps.py                      # 依赖注入：数据库会话、当前用户、权限校验
│   │
│   ├── routers/                     # API 路由层
│   │   ├── auth.py                  # 认证路由：注册、登录、Token 刷新
│   │   ├── projects.py              # 项目路由：CRUD、工作流执行、状态查询
│   │   ├── workflows.py             # 工作流路由：节点/边操作、版本管理
│   │   ├── media.py                 # 媒体路由：上传 URL、下载 URL、素材列表
│   │   ├── render.py                # 渲染路由：提交渲染、任务状态、下载成品
│   │   ├── collaboration.py         # 协作路由：邀请链接、权限管理
│   │   └── templates.py             # 模板路由：模板列表、导入模板
│   │
│   ├── services/                    # 业务逻辑层
│   │   ├── auth_service.py          # 认证逻辑：密码校验、Token 签发与验证
│   │   ├── project_service.py       # 项目 CRUD、画布数据持久化
│   │   ├── workflow_service.py      # 工作流解析、DAG 构建、执行调度
│   │   ├── media_service.py        # MinIO 预签名 URL 生成、素材元数据管理
│   │   ├── render_service.py        # 渲染任务创建、状态追踪、成品下载
│   │   └── collab_service.py        # 协作房间管理、操作广播、冲突仲裁
│   │
│   ├── models/                      # SQLAlchemy ORM 模型
│   │   ├── user.py                  # User 模型
│   │   ├── project.py              # Project 模型
│   │   ├── workflow_node.py        # WorkflowNode 模型
│   │   ├── workflow_edge.py        # WorkflowEdge 模型
│   │   ├── media_asset.py          # MediaAsset 模型
│   │   └── render_task.py          # RenderTask 模型
│   │
│   ├── schemas/                     # Pydantic 请求/响应模型
│   │   ├── auth.py                  # 登录/注册/Token 刷新 Schema
│   │   ├── project.py              # 项目 CRUD Schema
│   │   ├── workflow.py             # 工作流节点/边 Schema
│   │   ├── media.py                # 媒体资产 Schema
│   │   ├── render.py               # 渲染任务 Schema
│   │   └── common.py               # 通用 Schema（分页、错误响应）
│   │
│   ├── ai/                          # AI 编排模块
│   │   ├── dag_parser.py           # 画布 JSON → DAG 拓扑解析
│   │   ├── langgraph_engine.py     # LangGraph 状态机构建与执行
│   │   └── agents/                  # AI Agent 实现
│   │       ├── text_to_image.py    # 文生图 Agent（Stable Diffusion API）
│   │       ├── image_to_video.py   # 图生视频 Agent（Kling/Runway API）
│   │       └── text_to_speech.py   # 文生语音 Agent（CosyVoice API）
│   │
│   ├── ws/                          # WebSocket 模块
│   │   ├── sio_server.py           # python-socketio 服务端实例
│   │   ├── progress_handler.py     # 工作流进度推送
│   │   └── collab_handler.py       # 协作编辑事件处理
│   │
│   ├── core/                        # 核心工具模块
│   │   ├── security.py             # JWT 双 Token 签发/验证、密码哈希
│   │   ├── database.py             # SQLAlchemy 异步引擎与会话工厂
│   │   ├── minio_client.py        # MinIO 客户端封装
│   │   ├── redis_client.py        # Redis 连接池与工具方法
│   │   └── exceptions.py           # 自定义异常与全局错误处理
│   │
│   └── middleware/                  # 中间件
│       ├── cors.py                  # CORS 配置
│       └── logging.py              # 请求日志中间件
│
├── workers/                         # Celery Worker
│   ├── celery_app.py               # Celery 实例与配置
│   ├── ai_tasks.py                 # AI 推理任务（文生图/图生视频/TTS）
│   └── render_tasks.py             # 渲染任务（FFmpeg 合成）
│
├── migrations/                      # Alembic 数据库迁移
│   ├── env.py                      # 迁移环境配置
│   ├── versions/                    # 迁移版本文件
│   └── alembic.ini
│
├── tests/                           # 测试
│   ├── conftest.py                 # 测试 Fixtures（异步 DB、Mock 客户端）
│   ├── test_auth.py
│   ├── test_projects.py
│   ├── test_workflow.py
│   ├── test_media.py
│   └── test_render.py
│
├── docker/                          # Docker 配置
│   ├── Dockerfile.api              # API 服务镜像
│   ├── Dockerfile.worker           # Celery Worker 镜像
│   └── Dockerfile.ffmpeg           # FFmpeg GPU Worker 镜像
│
├── docker-compose.yml               # 本地开发编排
├── pyproject.toml                   # 项目依赖与工具配置
├── requirements.txt                 # 生产依赖
└── .env.example                     # 环境变量模板
```

## 5. API 设计

### 5.1 路由总览

基础路径：`/api/v1`

### 5.2 认证（Auth）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/register` | 用户注册 | 无 |
| POST | `/auth/login` | 用户登录，返回 Access + Refresh Token | 无 |
| POST | `/auth/refresh` | 刷新 Access Token | Refresh Token |
| POST | `/auth/logout` | 登出，使 Refresh Token 失效 | Access Token |
| GET | `/auth/me` | 获取当前用户信息 | Access Token |
| PUT | `/auth/me` | 更新当前用户信息 | Access Token |

### 5.3 项目（Projects）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/projects` | 获取当前用户项目列表（分页） | Access Token |
| POST | `/projects` | 创建项目 | Access Token |
| GET | `/projects/{project_id}` | 获取项目详情（含画布 JSON） | Access Token + 项目权限 |
| PUT | `/projects/{project_id}` | 更新项目（保存画布 JSON） | Access Token + 编辑权限 |
| DELETE | `/projects/{project_id}` | 删除项目 | Access Token + 所有者权限 |
| POST | `/projects/{project_id}/duplicate` | 复制项目 | Access Token + 读取权限 |

### 5.4 工作流（Workflows）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/projects/{project_id}/execute` | 提交工作流执行（提交 DAG） | Access Token + 编辑权限 |
| GET | `/projects/{project_id}/status` | 查询工作流执行状态 | Access Token + 读取权限 |
| POST | `/projects/{project_id}/nodes/{node_id}/retry` | 重试失败节点 | Access Token + 编辑权限 |
| POST | `/projects/{project_id}/resume` | 断点续执行工作流 | Access Token + 编辑权限 |
| POST | `/projects/{project_id}/cancel` | 取消工作流执行 | Access Token + 编辑权限 |
| GET | `/projects/{project_id}/versions` | 获取工作流版本列表 | Access Token + 读取权限 |
| POST | `/projects/{project_id}/versions` | 创建工作流版本快照 | Access Token + 编辑权限 |

### 5.5 媒体（Media）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/media` | 获取当前用户素材列表（分页、按类型筛选） | Access Token |
| POST | `/media/upload-url` | 获取预签名上传 URL（直传 MinIO） | Access Token |
| POST | `/media/confirm-upload` | 确认上传完成，写入元数据 | Access Token |
| GET | `/media/{asset_id}` | 获取素材详情 | Access Token |
| GET | `/media/{asset_id}/download-url` | 获取预签名下载 URL | Access Token |
| DELETE | `/media/{asset_id}` | 删除素材 | Access Token |

### 5.6 渲染（Render）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/projects/{project_id}/renders` | 获取项目渲染任务列表 | Access Token + 读取权限 |
| POST | `/projects/{project_id}/render` | 提交最终渲染 | Access Token + 编辑权限 |
| GET | `/renders/{render_id}` | 获取渲染任务详情 | Access Token |
| GET | `/renders/{render_id}/download-url` | 获取渲染成品下载 URL | Access Token |
| POST | `/renders/{render_id}/cancel` | 取消渲染任务 | Access Token + 编辑权限 |

### 5.7 协作（Collaboration）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/projects/{project_id}/collaborators` | 获取项目协作者列表 | Access Token + 读取权限 |
| POST | `/projects/{project_id}/invitations` | 生成邀请链接 | Access Token + 所有者权限 |
| POST | `/projects/{project_id}/join` | 通过邀请码加入协作 | Access Token |
| PUT | `/projects/{project_id}/collaborators/{user_id}` | 修改协作者权限 | Access Token + 所有者权限 |
| DELETE | `/projects/{project_id}/collaborators/{user_id}` | 移除协作者 | Access Token + 所有者权限 |

### 5.8 WebSocket 事件

| 方向 | 事件名 | 说明 |
|------|--------|------|
| 客户端→服务端 | `join_project` | 加入项目协作房间 |
| 客户端→服务端 | `leave_project` | 离开项目协作房间 |
| 客户端→服务端 | `cursor_move` | 广播光标位置 |
| 客户端→服务端 | `node_operation` | 发送节点操作增量 |
| 服务端→客户端 | `node_status` | 节点执行状态变更 |
| 服务端→客户端 | `node_progress` | 节点执行进度更新 |
| 服务端→客户端 | `render_progress` | 渲染任务进度更新 |
| 服务端→客户端 | `collaborator_joined` | 协作者加入通知 |
| 服务端→客户端 | `collaborator_left` | 协作者离开通知 |
| 服务端→客户端 | `remote_cursor` | 远程协作者光标位置 |
| 服务端→客户端 | `remote_operation` | 远程协作者操作增量 |
| 服务端→客户端 | `conflict_resolution` | 冲突仲裁结果通知 |

## 6. 数据模型

### 6.1 User（用户）

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | 用户唯一标识 |
| email | VARCHAR(255) | UNIQUE, NOT NULL | 登录邮箱 |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt 密码哈希 |
| display_name | VARCHAR(100) | | 显示名称 |
| avatar_url | TEXT | | 头像 URL |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'user', CHECK IN ('user', 'premium', 'admin') | 系统角色 |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE | 账号状态 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 更新时间 |

### 6.2 Project（项目）

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | 项目唯一标识 |
| user_id | UUID | FK → users.id, NOT NULL, ON DELETE CASCADE | 项目所有者 |
| name | VARCHAR(255) | NOT NULL | 项目名称 |
| description | TEXT | | 项目描述 |
| thumbnail_url | TEXT | | 缩略图 URL |
| canvas_data | JSONB | NOT NULL, DEFAULT '[]' | 画布节点数据（完整拓扑） |
| timeline_data | JSONB | NOT NULL, DEFAULT '{"tracks":[]}' | 时间轴数据 |
| is_template | BOOLEAN | NOT NULL, DEFAULT FALSE | 是否为模板 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 更新时间 |

索引：`idx_projects_user_id` ON (user_id), `idx_projects_updated_at` ON (updated_at DESC)

### 6.3 WorkflowNode（工作流节点）

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | 节点唯一标识 |
| project_id | UUID | FK → projects.id, NOT NULL, ON DELETE CASCADE | 所属项目 |
| node_type | VARCHAR(30) | NOT NULL, CHECK IN ('input', 'ai_inference', 'processing', 'control', 'output') | 节点大类 |
| subtype | VARCHAR(30) | NOT NULL | 节点子类型（如 text_to_image, image_to_video） |
| label | VARCHAR(255) | NOT NULL | 节点显示名称 |
| position_x | FLOAT | NOT NULL, DEFAULT 0 | 画布 X 坐标 |
| position_y | FLOAT | NOT NULL, DEFAULT 0 | 画布 Y 坐标 |
| params | JSONB | NOT NULL, DEFAULT '{}' | 节点参数配置 |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'idle', CHECK IN ('idle', 'pending', 'running', 'completed', 'failed') | 执行状态 |
| progress | INTEGER | NOT NULL, DEFAULT 0, CHECK (0-100) | 执行进度 |
| output_artifacts | JSONB | DEFAULT '[]' | 输出资产引用列表 |
| error_message | TEXT | | 失败时的错误信息 |
| retry_count | INTEGER | NOT NULL, DEFAULT 0 | 已重试次数 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 更新时间 |

索引：`idx_workflow_nodes_project_id` ON (project_id), `idx_workflow_nodes_status` ON (status)

### 6.4 WorkflowEdge（工作流连线）

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | 连线唯一标识 |
| project_id | UUID | FK → projects.id, NOT NULL, ON DELETE CASCADE | 所属项目 |
| source_node_id | UUID | FK → workflow_nodes.id, NOT NULL | 源节点 ID |
| target_node_id | UUID | FK → workflow_nodes.id, NOT NULL | 目标节点 ID |
| source_handle | VARCHAR(50) | | 源端口标识 |
| target_handle | VARCHAR(50) | | 目标端口标识 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 创建时间 |

索引：`idx_workflow_edges_project_id` ON (project_id), `idx_workflow_edges_source` ON (source_node_id), `idx_workflow_edges_target` ON (target_node_id)

### 6.5 MediaAsset（媒体资产）

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | 资产唯一标识 |
| user_id | UUID | FK → users.id, NOT NULL, ON DELETE CASCADE | 上传者 |
| project_id | UUID | FK → projects.id, ON DELETE SET NULL | 关联项目（可为空） |
| asset_type | VARCHAR(20) | NOT NULL, CHECK IN ('image', 'video', 'audio') | 资产类型 |
| filename | VARCHAR(500) | NOT NULL | 原始文件名 |
| storage_key | VARCHAR(1000) | NOT NULL, UNIQUE | MinIO 存储路径 |
| file_size | BIGINT | NOT NULL, DEFAULT 0 | 文件大小（字节） |
| mime_type | VARCHAR(100) | | MIME 类型 |
| duration | FLOAT | | 音视频时长（秒） |
| width | INTEGER | | 图片/视频宽度 |
| height | INTEGER | | 图片/视频高度 |
| metadata | JSONB | DEFAULT '{}' | 扩展元数据 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 创建时间 |

索引：`idx_media_assets_user_id` ON (user_id), `idx_media_assets_project_id` ON (project_id), `idx_media_assets_asset_type` ON (asset_type)

### 6.6 RenderTask（渲染任务）

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | 任务唯一标识 |
| project_id | UUID | FK → projects.id, NOT NULL, ON DELETE CASCADE | 所属项目 |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'queued', CHECK IN ('queued', 'rendering', 'completed', 'failed', 'cancelled') | 任务状态 |
| progress | INTEGER | NOT NULL, DEFAULT 0, CHECK (0-100) | 渲染进度 |
| output_format | VARCHAR(10) | NOT NULL, DEFAULT 'mp4', CHECK IN ('mp4', 'mov', 'webm') | 输出格式 |
| output_storage_key | VARCHAR(1000) | | 成品 MinIO 存储路径 |
| resolution | VARCHAR(20) | DEFAULT '1080p' | 输出分辨率 |
| error_message | TEXT | | 失败时的错误信息 |
| started_at | TIMESTAMPTZ | | 开始渲染时间 |
| completed_at | TIMESTAMPTZ | | 完成时间 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | 创建时间 |

索引：`idx_render_tasks_project_id` ON (project_id), `idx_render_tasks_status` ON (status)

## 7. 工作流引擎

### 7.1 LangGraph DAG 执行引擎

工作流引擎的核心职责是将前端 React Flow 画布的拓扑 JSON 转化为可执行的 DAG 状态机，并按依赖关系调度节点执行。

```
┌──────────────────────────────────────────────────────────┐
│                   工作流执行流程                            │
│                                                          │
│  前端画布 JSON                                             │
│       │                                                  │
│       ▼                                                  │
│  DAG Parser ──> 拓扑排序 ──> 依赖图                       │
│       │                                                  │
│       ▼                                                  │
│  LangGraph StateGraph                                    │
│       │                                                  │
│       ├──> 并行层 1: [text_input, audio_input]            │
│       ├──> 并行层 2: [text_to_image, text_to_speech]       │
│       ├──> 并行层 3: [image_to_video]                      │
│       └──> 汇聚层:   [video_output]                       │
│                                                          │
│  每个节点 ──> Celery Task ──> AI API 调用 ──> MinIO 存储  │
│       │                                                  │
│       ▼                                                  │
│  Redis Pub/Sub ──> WebSocket ──> 前端进度更新              │
└──────────────────────────────────────────────────────────┘
```

### 7.2 节点状态机

每个工作流节点在执行过程中遵循以下状态转换：

```
                    ┌──────────┐
          ┌────────>│  idle    │<────────┐
          │         └────┬─────┘         │
          │              │ execute       │ reset
          │              ▼              │
          │         ┌──────────┐         │
          │         │ pending  │─────────┘
          │         └────┬─────┘
          │              │ worker pickup
          │              ▼
          │         ┌──────────┐
          │         │ running  │──────┐
          │         └────┬─────┘      │
          │              │ success    │ failure
          │              ▼            ▼
          │         ┌──────────┐  ┌──────────┐
          │         │completed │  │  failed  │──┐
          │         └──────────┘  └──────────┘  │
          │                         │  retry     │ max_retries
          │                         ▼            │ exceeded
          │                    ┌──────────┐      │
          └────────────────────│ pending  │<─────┘
                               └──────────┘
```

状态转换规则：

| 当前状态 | 触发条件 | 目标状态 | 说明 |
|----------|----------|----------|------|
| idle | 工作流执行启动 | pending | 等待上游依赖完成 |
| pending | 上游依赖全部完成 | running | Worker 开始执行 |
| pending | 上游依赖失败 | failed | 依赖不可满足，标记失败 |
| running | 任务执行成功 | completed | 输出资产写入 MinIO |
| running | 任务执行失败 | failed | 记录错误信息 |
| failed | 用户手动重试且 retry_count < 3 | pending | 重置状态，重新入队 |
| failed | retry_count >= 3 | failed | 保持失败，不再自动重试 |
| completed | 用户重新执行 | pending | 支持重新执行已完成节点 |

### 7.3 依赖解析

DAG Parser 负责将前端画布 JSON 解析为执行依赖图：

1. **拓扑排序**：根据 WorkflowEdge 的 source→target 关系构建邻接表，执行 Kahn 算法拓扑排序
2. **并行分层**：同一层内无依赖关系的节点可并行执行，最大化吞吐
3. **环检测**：拓扑排序时检测环，若存在环则拒绝执行并返回错误
4. **条件分支**：`if_else` 控制节点根据条件表达式动态选择下游分支，未选中分支标记为 `skipped`
5. **循环展开**：`loop` 控制节点根据循环次数展开为多次串行执行

### 7.4 失败重试策略

| 策略 | 配置 | 说明 |
|------|------|------|
| 自动重试 | 最多 3 次 | 单个节点失败后自动重试 |
| 指数退避 | 5s → 15s → 45s | 避免服务端过载 |
| 上游复用 | 重试时跳过已完成的上游节点 | 复用 MinIO 中的输出资产 |
| 断点续执行 | 从失败节点恢复，跳过已完成节点 | 基于 Redis 中间状态快照 |
| 全量重执行 | 清除所有中间状态，从头执行 | 用户主动选择 |
| 参数调整重试 | 允许修改失败节点参数后重试 | 如更换模型、降低分辨率 |

## 8. AI 推理任务

### 8.1 Celery 任务设计

所有 AI 推理任务通过 Celery 异步执行，任务结果通过 Redis Backend 存储，进度通过 Redis Pub/Sub 推送到 FastAPI，再由 WebSocket 转发前端。

### 8.2 任务分类

#### 文生图任务（text_to_image）

| 配置项 | 值 | 说明 |
|--------|------|------|
| 队列 | `ai_gpu` | GPU 队列 |
| 优先级 | 5（中） | 默认优先级 |
| 超时 | 300s | 单次推理超时 |
| 自动重试 | 3 次，指数退避 | API 调用失败自动重试 |
| 输入 | prompt, negative_prompt, width, height, model, steps | 文本提示词与生成参数 |
| 输出 | MinIO 图片路径 | PNG/JPEG 格式 |

#### 图生视频任务（image_to_video）

| 配置项 | 值 | 说明 |
|--------|------|------|
| 队列 | `ai_gpu` | GPU 队列 |
| 优先级 | 3（高） | 视频生成优先级高于图片 |
| 超时 | 600s | 视频生成耗时较长 |
| 自动重试 | 2 次，指数退避 | 视频生成成本高，减少重试 |
| 输入 | image_storage_key, prompt, duration, fps, model | 源图与视频参数 |
| 输出 | MinIO 视频路径 | MP4 格式 |

#### 文生语音任务（text_to_speech）

| 配置项 | 值 | 说明 |
|--------|------|------|
| 队列 | `ai_cpu` | CPU 队列 |
| 优先级 | 7（低） | 语音生成优先级最低 |
| 超时 | 180s | 语音合成较快 |
| 自动重试 | 3 次，指数退避 | TTS API 相对稳定 |
| 输入 | text, voice_id, speed, model | 文本与语音参数 |
| 输出 | MinIO 音频路径 | WAV/MP3 格式 |

### 8.3 任务优先级

| 优先级 | 值 | 适用任务 | 说明 |
|--------|------|----------|------|
| 高 | 3 | 图生视频、最终渲染 | 用户等待时间最长，优先调度 |
| 中 | 5 | 文生图、视频处理 | 常规 AI 推理任务 |
| 低 | 7 | TTS、图片处理 | 耗时短，可延后调度 |

> 注意：Celery 优先级数值越小优先级越高（RabbitMQ 语义）。

### 8.4 任务超时与重试配置

```python
# celery_app.py

CELERY_TASK_CONFIGS = {
    "text_to_image": {
        "time_limit": 300,          # 硬超时（秒），超时后强制终止
        "soft_time_limit": 270,     # 软超时，抛出 SoftTimeLimitExceeded
        "max_retries": 3,
        "default_retry_delay": 5,   # 首次重试延迟（秒）
        "autoretry_for": (ExternalAPIError, TimeoutError),
        "retry_backoff": True,      # 启用指数退避
        "retry_backoff_max": 60,    # 最大退避时间
        "retry_jitter": True,       # 添加随机抖动
    },
    "image_to_video": {
        "time_limit": 600,
        "soft_time_limit": 570,
        "max_retries": 2,
        "default_retry_delay": 10,
        "autoretry_for": (ExternalAPIError, TimeoutError),
        "retry_backoff": True,
        "retry_backoff_max": 120,
        "retry_jitter": True,
    },
    "text_to_speech": {
        "time_limit": 180,
        "soft_time_limit": 160,
        "max_retries": 3,
        "default_retry_delay": 5,
        "autoretry_for": (ExternalAPIError, TimeoutError),
        "retry_backoff": True,
        "retry_backoff_max": 30,
        "retry_jitter": True,
    },
}
```

## 9. 协作系统

### 9.1 Socket.IO 房间管理

每个项目对应一个 Socket.IO 房间，房间 ID 为 `project:{project_id}`。

```
┌──────────────────────────────────────────────────────────┐
│                  Socket.IO 房间模型                        │
│                                                          │
│  project:abc-123                                         │
│  ├── 用户 A (owner)   ── 光标颜色: #7C3AED              │
│  ├── 用户 B (editor)  ── 光标颜色: #3B82F6              │
│  └── 用户 C (viewer)  ── 光标颜色: #06B6D4 (只读)       │
│                                                          │
│  事件广播范围:                                           │
│  ├── node_operation  ──> 房间内所有人                     │
│  ├── cursor_move     ──> 房间内除发送者外所有人           │
│  └── conflict_resolution ──> 仅冲突方                   │
└──────────────────────────────────────────────────────────┘
```

房间生命周期：

| 事件 | 处理逻辑 |
|------|----------|
| `join_project` | 验证项目权限，加入房间，广播 `collaborator_joined` |
| `leave_project` | 离开房间，广播 `collaborator_left` |
| 断线 | 30 秒内重连可恢复，超时自动离开房间 |
| 项目删除 | 强制解散房间，通知所有成员 |

### 9.2 操作广播

采用 **操作增量广播** 而非全量状态同步，降低带宽消耗：

```python
# 操作增量格式
{
    "type": "node_operation",
    "payload": {
        "operation": "update_node_params",  # 操作类型
        "node_id": "uuid-xxx",
        "delta": {                           # 增量数据
            "params.prompt": "a beautiful sunset"
        },
        "timestamp": 1719000000000,          # 客户端时间戳
        "user_id": "user-xxx"
    }
}
```

支持的增量操作类型：

| 操作 | 说明 | 增量字段 |
|------|------|----------|
| add_node | 添加节点 | 完整节点数据 |
| remove_node | 删除节点 | node_id |
| move_node | 移动节点 | node_id, position_x, position_y |
| update_node_params | 修改节点参数 | node_id, params 增量 |
| add_edge | 添加连线 | 完整边数据 |
| remove_edge | 删除连线 | edge_id |

### 9.3 OT 冲突解决策略

采用 **Last-Writer-Wins (LWW) + 操作转换** 混合策略：

1. **乐观更新**：本地操作立即生效，不等服务端确认
2. **服务端仲裁**：操作到达服务端后，按时间戳排序，后到者覆盖先到者
3. **冲突检测**：当两个用户同时修改同一节点的同一参数时，服务端检测冲突
4. **冲突通知**：被覆盖方收到 `conflict_resolution` 事件，包含服务端最终状态，客户端回退本地修改并应用服务端状态
5. **只读保护**：viewer 角色的操作被服务端拒绝，仅广播只读光标

```
用户A: update_node_params(node_1, {prompt: "sunset"})  ──> 服务端 (t=100)
用户B: update_node_params(node_1, {prompt: "ocean"})   ──> 服务端 (t=101)

服务端仲裁: B 的操作时间戳更新，以 B 为准
  ├── 广播 B 的操作给 A
  └── 向 A 发送 conflict_resolution，A 回退为 "ocean"
```

## 10. 媒体处理

### 10.1 MinIO 存储策略

```
minio-bucket/
├── uploads/                           # 用户上传的原始素材
│   └── {user_id}/
│       └── {year}/{month}/
│           └── {uuid}.{ext}           # 如: uploads/uid/2024/06/abc.png
│
├── generated/                         # AI 生成的产物
│   └── {project_id}/
│       └── {node_id}/
│           └── {uuid}.{ext}           # 如: generated/pid/nid/def.mp4
│
└── renders/                           # 最终渲染成品
    └── {project_id}/
        └── {render_id}/
            └── output.{ext}           # 如: renders/pid/rid/output.mp4
```

存储策略：

| 策略 | 配置 | 说明 |
|------|------|------|
| Bucket | `ai-canvas-flow` | 单 Bucket，通过前缀分区 |
| 最小分片 | 5 MB | Multipart Upload 分片大小 |
| 生命周期 | generated/ 30 天自动清理 | AI 生成中间产物定期清理 |
| 版本控制 | 关闭 | 通过数据库元数据管理版本 |

### 10.2 预签名 URL 直传

上传流程采用预签名 URL 直传，避免大文件经过后端服务器：

```
┌────────┐    1. 请求上传 URL     ┌──────────┐
│ 前端    │ ──────────────────> │ FastAPI   │
│        │ <────────────────── │           │
│        │    2. 返回预签名 URL  │           │
│        │                       └──────────┘
│        │    3. PUT 直传文件     ┌──────────┐
│        │ ──────────────────> │  MinIO    │
│        │ <────────────────── │           │
│        │    4. 上传完成       └──────────┘
│        │                       ┌──────────┐
│        │  5. 确认上传完成      │ FastAPI   │
│        │ ──────────────────> │           │
│        │ <────────────────── │           │
│        │    6. 写入元数据      │           │
└────────┘                       └──────────┘
```

预签名 URL 配置：

| 配置项 | 值 | 说明 |
|--------|------|------|
| 上传 URL 有效期 | 5 分钟 | PUT 预签名 URL 过期时间 |
| 下载 URL 有效期 | 1 小时 | GET 预签名 URL 过期时间 |
| 最大文件大小 | 500 MB | 单文件上传限制 |
| 允许的 MIME 类型 | image/*, video/*, audio/* | 限制上传类型 |

### 10.3 HLS 流式播放

视频播放采用 HLS（HTTP Live Streaming）协议，避免直接加载大体积 MP4 文件：

1. **上传时转码**：用户上传视频后，Celery Worker 自动转码为 HLS 格式（.m3u8 + .ts 切片）
2. **按需转码**：AI 生成的视频在首次播放请求时触发 HLS 转码，转码结果缓存到 MinIO
3. **多分辨率**：支持 360p / 720p / 1080p 自适应码率

HLS 转码 FFmpeg 命令：

```bash
ffmpeg -i input.mp4 \
  -master_pl_name master.m3u8 \
  -filter_complex "[0:v]split=2[v1][v2]; \
    [v1]scale=w=1280:h=720[v1out]; \
    [v2]scale=w=854:h=480[v2out]" \
  -map "[v1out]" -c:v:h264 libx264 -b:v:h264 2800k -maxrate:v:h264 3500k \
  -map "[v2out]" -c:v:h264_1 libx264 -b:v:h264_1 1400k -maxrate:v:h264_1 1750k \
  -map 0:a -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "stream_%v/data%06d.ts" \
  -var_stream_map "v:0,a:0 v:1,a:1" \
  stream_%v.m3u8
```

### 10.4 FFmpeg 渲染流水线

最终渲染采用后端 GPU Worker 执行原生 FFmpeg 合成：

```
┌──────────────────────────────────────────────────────────┐
│                  FFmpeg 渲染流水线                        │
│                                                          │
│  1. 收集素材                                             │
│     ├── 从 MinIO 下载所有视频片段                         │
│     ├── 从 MinIO 下载所有音频片段                         │
│     └── 从 MinIO 下载字幕文件                             │
│                                                          │
│  2. 构建滤镜图                                           │
│     ├── 视频轨道叠加 (overlay)                            │
│     ├── 音频轨道混音 (amerge + pan)                       │
│     ├── 字幕烧录 (subtitles filter)                       │
│     └── 特效处理 (scale, pad, trim)                      │
│                                                          │
│  3. 编码输出                                             │
│     ├── H.264/H.265 编码 (GPU 加速)                      │
│     ├── AAC 音频编码                                      │
│     └── 输出到 MinIO                                      │
│                                                          │
│  4. 进度上报                                             │
│     └── 通过 Redis Pub/Sub 上报渲染进度                   │
└──────────────────────────────────────────────────────────┘
```

渲染参数配置：

| 参数 | 默认值 | 可选值 | 说明 |
|------|--------|--------|------|
| 输出格式 | mp4 | mp4, mov, webm | 容器格式 |
| 视频编码 | h264 | h264, h265, vp9 | 编码器 |
| 分辨率 | 1080p | 720p, 1080p, 4k | 输出分辨率 |
| 帧率 | 30 | 24, 30, 60 | 输出帧率 |
| 码率 | 8M | 自定义 | 视频码率 |
| 音频编码 | aac | aac, opus | 音频编码器 |
| 音频码率 | 192k | 128k, 192k, 320k | 音频码率 |

## 11. 认证与安全

### 11.1 JWT 双 Token 方案

采用 Access Token + Refresh Token 双 Token 机制：

| Token 类型 | 有效期 | 存储 | 用途 |
|------------|--------|------|------|
| Access Token | 15 分钟 | 内存（前端 Zustand Store） | API 请求鉴权 |
| Refresh Token | 7 天 | HttpOnly Cookie | 刷新 Access Token |

认证流程：

```
┌────────┐                         ┌──────────┐
│ 前端    │                         │ FastAPI   │
└───┬────┘                         └────┬─────┘
    │                                   │
    │  POST /auth/login                 │
    │  {email, password}                │
    │ ─────────────────────────────────>│
    │                                   │ 验证密码
    │                                   │ 签发 Token
    │  200 OK                           │
    │  {access_token} + Set-Cookie      │
    │ <─────────────────────────────────│
    │                                   │
    │  GET /api/v1/projects             │
    │  Authorization: Bearer <access>    │
    │ ─────────────────────────────────>│
    │                                   │ 验证 Access Token
    │  200 OK                           │
    │ <─────────────────────────────────│
    │                                   │
    │  ... 15 分钟后 Access Token 过期  │
    │                                   │
    │  POST /auth/refresh               │
    │  Cookie: refresh_token=xxx        │
    │ ─────────────────────────────────>│
    │                                   │ 验证 Refresh Token
    │                                   │ 签发新 Access Token
    │  200 OK                           │
    │  {access_token}                   │
    │ <─────────────────────────────────│
    │                                   │
    │  POST /auth/logout                │
    │ ─────────────────────────────────>│
    │                                   │ 清除 Refresh Token
    │  204 No Content                   │
    │ <─────────────────────────────────│
```

Token 结构：

```python
# Access Token Payload
{
    "sub": "user_uuid",        # 用户 ID
    "role": "user",            # 系统角色
    "type": "access",          # Token 类型
    "exp": 1719000900,         # 过期时间
    "iat": 1719000000          # 签发时间
}

# Refresh Token Payload
{
    "sub": "user_uuid",
    "type": "refresh",
    "exp": 1719604800,
    "iat": 1719000000,
    "jti": "unique_token_id"   # 用于 Token 撤销
}
```

### 11.2 RBAC 权限模型

系统采用两层权限模型：**系统角色** + **项目角色**。

#### 系统角色

| 角色 | 权限 | 说明 |
|------|------|------|
| user | 创建项目、管理自己的资源 | 普通用户 |
| premium | 解锁高级 AI 模型、GPU 渲染加速、大文件存储 | 高级用户 |
| admin | 管理所有用户和项目、系统配置 | 管理员 |

#### 项目角色

| 角色 | 权限 | 说明 |
|------|------|------|
| owner | 编辑、删除项目、管理协作者、导出 | 项目所有者 |
| editor | 编辑画布/时间轴、执行工作流、上传素材 | 编辑者 |
| viewer | 查看画布、预览视频、不可编辑 | 只读者 |

权限校验流程：

```
请求 → JWT 验证 → 系统角色检查 → 项目角色检查 → 放行/拒绝
                    (admin 跳过项目检查)      (owner/editor/viewer)
```

## 12. 部署架构

### 12.1 Docker Compose 编排

```yaml
# docker-compose.yml
services:
  # ── API 服务 ──
  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/ai_canvas_flow
      - REDIS_URL=redis://redis:6379/0
      - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672//
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
      minio:
        condition: service_healthy
    volumes:
      - ./app:/app/app  # 开发环境热重载

  # ── Celery AI Worker ──
  ai-worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    command: celery -A workers.celery_app worker -Q ai_gpu,ai_cpu --concurrency=2 -l INFO
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/ai_canvas_flow
      - REDIS_URL=redis://redis:6379/0
      - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672//
      - MINIO_ENDPOINT=minio:9000
    depends_on:
      - rabbitmq
      - redis
      - postgres
      - minio

  # ── Celery Render Worker (GPU) ──
  render-worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.ffmpeg
    command: celery -A workers.celery_app worker -Q render --concurrency=1 -l INFO
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/ai_canvas_flow
      - REDIS_URL=redis://redis:6379/0
      - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672//
      - MINIO_ENDPOINT=minio:9000
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    depends_on:
      - rabbitmq
      - redis
      - postgres
      - minio

  # ── Celery Beat (定时任务调度) ──
  celery-beat:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    command: celery -A workers.celery_app beat -l INFO
    environment:
      - REDIS_URL=redis://redis:6379/0
      - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672//
    depends_on:
      - rabbitmq
      - redis

  # ── PostgreSQL ──
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: ai_canvas_flow
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ── Redis ──
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ── RabbitMQ ──
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"  # 管理界面
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_running"]
      interval: 10s
      timeout: 10s
      retries: 5

  # ── MinIO ──
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"  # Console
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:
  minio_data:
```

### 12.2 服务端口映射

| 服务 | 端口 | 说明 |
|------|------|------|
| FastAPI | 8000 | API + WebSocket |
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 缓存 + Pub/Sub |
| RabbitMQ | 5672 | AMQP 协议 |
| RabbitMQ Management | 15672 | 管理界面 |
| MinIO API | 9000 | S3 兼容 API |
| MinIO Console | 9001 | 管理界面 |

### 12.3 启动命令

```bash
# 启动所有服务
docker compose up -d

# 启动并重建镜像
docker compose up -d --build

# 查看日志
docker compose logs -f api

# 运行数据库迁移
docker compose exec api alembic upgrade head

# 创建新的迁移文件
docker compose exec api alembic revision --autogenerate -m "description"
```

## 13. 开发规范

### 13.1 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 文件名 | snake_case | `project_service.py`, `text_to_image.py` |
| 类名 | PascalCase | `ProjectService`, `WorkflowNode`, `MediaAssetCreate` |
| 函数/方法 | snake_case | `get_project_by_id()`, `execute_workflow()` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| 数据库表名 | snake_case 复数 | `users`, `projects`, `media_assets` |
| 数据库列名 | snake_case | `user_id`, `created_at`, `storage_key` |
| API 路径 | kebab-case | `/api/v1/render-tasks` |
| 环境变量 | UPPER_SNAKE_CASE | `DATABASE_URL`, `MINIO_ENDPOINT` |
| Pydantic Schema | PascalCase + 后缀 | `ProjectCreate`, `ProjectResponse`, `ProjectListParams` |

### 13.2 错误处理

统一错误响应格式：

```python
{
    "error": {
        "code": "PROJECT_NOT_FOUND",
        "message": "项目不存在",
        "details": {}  # 可选，额外错误详情
    }
}
```

错误码规范：

| 前缀 | 范围 | 说明 |
|------|------|------|
| AUTH_* | 1000-1999 | 认证相关错误 |
| PROJECT_* | 2000-2999 | 项目相关错误 |
| WORKFLOW_* | 3000-3999 | 工作流相关错误 |
| MEDIA_* | 4000-4999 | 媒体相关错误 |
| RENDER_* | 5000-5999 | 渲染相关错误 |

常用错误码：

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| AUTH_INVALID_CREDENTIALS | 401 | 邮箱或密码错误 |
| AUTH_TOKEN_EXPIRED | 401 | Token 已过期 |
| AUTH_PERMISSION_DENIED | 403 | 权限不足 |
| PROJECT_NOT_FOUND | 404 | 项目不存在 |
| WORKFLOW_CYCLE_DETECTED | 422 | 工作流存在环 |
| WORKFLOW_NODE_FAILED | 422 | 节点执行失败 |
| MEDIA_FILE_TOO_LARGE | 413 | 文件超过大小限制 |
| MEDIA_UNSUPPORTED_TYPE | 415 | 不支持的文件类型 |
| RENDER_CONCURRENCY_LIMIT | 429 | 渲染任务并发数超限 |

### 13.3 日志规范

```python
import structlog

logger = structlog.get_logger()

# 日志格式：JSON 结构化日志
# {
#     "timestamp": "2024-06-22T10:00:00Z",
#     "level": "info",
#     "event": "workflow_execution_started",
#     "project_id": "uuid-xxx",
#     "user_id": "uuid-yyy",
#     "node_count": 5
# }

# 使用规范
logger.info("workflow_execution_started", project_id=project_id, user_id=user_id, node_count=len(nodes))
logger.error("node_execution_failed", node_id=node_id, error=str(e), retry_count=retry_count)
logger.warning("upload_size_exceeded", file_size=file_size, max_size=MAX_FILE_SIZE)
```

日志级别使用：

| 级别 | 使用场景 |
|------|----------|
| DEBUG | 开发调试信息，生产环境关闭 |
| INFO | 正常业务流程关键节点（请求进入、任务开始/完成） |
| WARNING | 非预期但可恢复的情况（重试、降级） |
| ERROR | 不可恢复的错误（外部 API 失败、数据异常） |

### 13.4 测试策略

| 测试类型 | 工具 | 覆盖范围 | 运行时机 |
|----------|------|----------|----------|
| 单元测试 | pytest + pytest-asyncio | Service 层业务逻辑 | 每次提交 |
| API 测试 | pytest + httpx AsyncClient | Router 层请求/响应 | 每次提交 |
| 集成测试 | pytest + testcontainers | 数据库/MinIO/Redis 交互 | 合并前 |
| 端到端测试 | pytest + Socket.IO Client | 完整工作流执行 | 发布前 |

测试约定：

- 测试文件命名：`test_{module_name}.py`
- 测试类命名：`Test{ClassName}`
- 测试方法命名：`test_{scenario}_{expected_result}`
- 使用 `conftest.py` 管理公共 Fixtures
- 异步测试使用 `pytest-asyncio` 的 `@pytest.mark.asyncio` 装饰器
- Mock 外部 AI API 调用，不依赖真实外部服务
- 使用独立测试数据库，测试后自动清理

## 14. 环境配置

### 14.1 .env 变量清单

```bash
# ══════════════════════════════════════
# 应用配置
# ══════════════════════════════════════
APP_NAME=AI Canvas Flow
APP_ENV=development                    # development | staging | production
APP_DEBUG=true                          # 调试模式
APP_HOST=0.0.0.0                       # 监听地址
APP_PORT=8000                           # 监听端口
CORS_ORIGINS=http://localhost:5173      # 允许的前端源，多个用逗号分隔

# ══════════════════════════════════════
# 数据库配置
# ══════════════════════════════════════
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/ai_canvas_flow
DATABASE_POOL_SIZE=20                   # 连接池大小
DATABASE_MAX_OVERFLOW=10                # 最大溢出连接数

# ══════════════════════════════════════
# Redis 配置
# ══════════════════════════════════════
REDIS_URL=redis://localhost:6379/0

# ══════════════════════════════════════
# RabbitMQ 配置
# ══════════════════════════════════════
RABBITMQ_URL=amqp://guest:guest@localhost:5672//

# ══════════════════════════════════════
# MinIO 配置
# ══════════════════════════════════════
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=ai-canvas-flow
MINIO_SECURE=false                       # 生产环境设为 true

# ══════════════════════════════════════
# JWT 配置
# ══════════════════════════════════════
JWT_SECRET_KEY=your-secret-key-change-in-production
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ══════════════════════════════════════
# AI API 配置
# ══════════════════════════════════════
STABLE_DIFFUSION_API_URL=https://api.stability.ai/v2beta/stable-image/generate/sd3
STABLE_DIFFUSION_API_KEY=sk-xxx
KLING_API_URL=https://api.klingai.com/v1/videos/image2video
KLING_API_KEY=xxx
COSYVOICE_API_URL=https://api.cosyvoice.ai/v1/tts
COSYVOICE_API_KEY=xxx

# ══════════════════════════════════════
# Celery 配置
# ══════════════════════════════════════
CELERY_BROKER_URL=amqp://guest:guest@localhost:5672//
CELERY_RESULT_BACKEND=redis://localhost:6379/1
CELERY_TASK_ALWAYS_EAGER=false          # 开发环境可设为 true 同步执行

# ══════════════════════════════════════
# 上传配置
# ══════════════════════════════════════
MAX_UPLOAD_SIZE_MB=500                  # 最大上传文件大小（MB）
UPLOAD_PRESIGN_EXPIRE_SECONDS=300       # 预签名上传 URL 有效期（秒）
DOWNLOAD_PRESIGN_EXPIRE_SECONDS=3600   # 预签名下载 URL 有效期（秒）

# ══════════════════════════════════════
# 日志配置
# ══════════════════════════════════════
LOG_LEVEL=INFO                          # DEBUG | INFO | WARNING | ERROR
LOG_FORMAT=json                         # json | console
```
