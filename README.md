# AI Canvas Flow

可视化 AI 视频创作工作流平台 — 通过拖拽节点编排 AI 推理流程，结合时间轴编辑器完成视频创作。

## 项目结构

```
AI_Canvas_Flow/
├── frontend/          # 前端项目 (React + Vite + TypeScript)
├── backend/           # 后端项目 (FastAPI + LangGraph + Celery)
├── docs/              # 项目文档
└── README.md
```

## 功能特性

- **工作流编辑器**：基于 React Flow 的无限画布，5 类 16 种节点类型，拖拽/点击添加，连线编排
- **时间轴编辑器**：多轨道时间线（视频/音频/字幕/特效），精确对齐，播放控制
- **AI 推理引擎**：文生图、图生视频、文生语音、高清放大、风格化、抠图、扩图
- **撤销/重做系统**：分支式操作历史树，100 步深度，500ms 同类操作自动合并
- **自动保存与崩溃恢复**：2 秒防抖 + 30 秒定时兜底，localStorage 快照，崩溃恢复对话框
- **媒体资产管理**：素材上传、预览、分类、版本管理
- **渲染与导出**：前端轻量预览 + 后端重度合成，多格式导出
- **模板市场**：预设模板快速开始
- **协作功能**（规划中）：多用户实时协同编辑、OT/CRDT 冲突解决

## 技术栈

### 前端

| 类别 | 技术 |
|------|------|
| 构建工具 | Vite 6.x |
| UI 框架 | React 18 + TypeScript 5.8 |
| 画布引擎 | @xyflow/react (React Flow) 12.x |
| 状态管理 | Zustand 5.x |
| 路由 | React Router DOM 7.x |
| 样式 | Tailwind CSS 3.4 |
| 视频播放 | Video.js 8.x |
| 视频处理 | @ffmpeg/ffmpeg |
| 拖拽 | @dnd-kit |
| 实时通信 | Socket.IO Client |
| 图标 | Lucide React |

### 后端

| 类别 | 技术 |
|------|------|
| Web 框架 | FastAPI (Python 3.12+) |
| AI 编排 | LangChain + LangGraph |
| 任务队列 | Celery + RabbitMQ |
| 缓存 | Redis |
| 数据库 | PostgreSQL + SQLAlchemy 2.0 (async) |
| 对象存储 | MinIO |
| 实时通信 | python-socketio |
| 数据库迁移 | Alembic |
| 容器化 | Docker + Docker Compose |

## 快速开始

### 前端

```bash
cd frontend

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建
pnpm build

# 类型检查
pnpm check
```

开发服务器运行在 http://localhost:5173

### 后端

```bash
cd backend

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际配置

# 启动开发服务器
uvicorn app.main:app --reload --port 8000

# 启动 Celery Worker
celery -A app.tasks.celery_app worker -l info

# 数据库迁移
alembic upgrade head
```

API 服务运行在 http://localhost:8000，文档地址 http://localhost:8000/docs

### Docker Compose（一键启动全部服务）

```bash
# 在项目根目录
docker compose up -d
```

## 文档

| 文档 | 说明 |
|------|------|
| [前端开发技术文档](docs/frontend-technical-guide.md) | 前端架构、状态管理、组件体系、开发规范 |
| [后端开发技术文档](docs/backend-technical-guide.md) | 后端架构、API 设计、数据模型、部署方案 |
| [AI 视频工作流方案](docs/AI_Video_Workflow方案.md) | 系统架构全景与核心功能设计 |

## License

MIT
