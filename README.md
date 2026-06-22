# AI Canvas Flow

可视化 AI 视频创作工作流平台 — 通过拖拽节点编排 AI 推理流程，结合时间轴编辑器完成视频创作。

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

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装与运行

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 类型检查
pnpm check

# 代码检查
pnpm lint
```

开发服务器默认运行在 http://localhost:5173

## 项目结构

```
src/
├── App.tsx                    # 根组件 + 路由配置
├── main.tsx                   # 入口文件
├── components/                # UI 组件
│   ├── Layout.tsx             # 主布局（侧边导航）
│   ├── EditorLayout.tsx       # 编辑器布局（工具栏+自动保存+快捷键）
│   ├── canvas/                # 画布（React Flow + 自定义节点）
│   ├── panels/                # 面板（节点面板 + 属性面板）
│   ├── preview/               # 视频预览
│   └── timeline/              # 时间轴编辑器
├── pages/                     # 页面（6 个）
├── stores/                    # Zustand 状态管理（6 个 Store）
├── types/                     # TypeScript 类型定义
├── hooks/                     # 自定义 Hooks
├── utils/                     # 工具函数 + Mock 数据
└── lib/                       # 通用工具库
```

## 核心架构

### 路由

| 路径 | 布局 | 页面 |
|------|------|------|
| `/` | Layout | 工作台首页 |
| `/media` | Layout | 媒体库 |
| `/render` | Layout | 渲染中心 |
| `/templates` | Layout | 模板市场 |
| `/settings` | Layout | 用户设置 |
| `/editor/:projectId` | EditorLayout | 工作流编辑器 |

### 状态管理

| Store | 职责 |
|-------|------|
| `canvasStore` | 画布节点、边、选中状态 |
| `timelineStore` | 轨道、片段、播放控制 |
| `projectStore` | 项目列表、当前项目 |
| `historyStore` | 撤销/重做（分支式操作历史树） |
| `autoSaveStore` | 自动保存、崩溃恢复 |
| `authStore` | 用户认证 |

### 节点类型

```
输入：文本输入 / 图片输入 / 音频输入
AI推理：文生图 / 图生视频 / 文生语音
处理：高清放大 / 风格化 / 抠图 / 扩图
控制：条件分支 / 循环 / 合并
输出：视频输出 / 图片输出 / 音频输出
```

## 快捷键

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+Z` | 撤销 |
| `Ctrl+Shift+Z` | 重做 |
| `Ctrl+S` | 保存项目 |
| `Ctrl+Shift+H` | 操作历史面板 |
| `Delete` | 删除选中节点 |
| `Space` | 播放/暂停 |

## 设计系统

深色科技风主题：

- **主背景**：`#0F0F14`
- **面板背景**：`#1A1A2E`
- **主强调色**：`#7C3AED`（霓虹紫）
- **辅助强调色**：`#3B82F6`（霓虹蓝）
- **字体**：Space Grotesk（标题）+ DM Sans（正文）

## 文档

- [前端开发技术文档](docs/frontend-technical-guide.md)
- [AI 视频工作流方案](docs/AI_Video_Workflow方案.md)

## 后端规划

| 组件 | 技术 |
|------|------|
| Web 框架 | FastAPI |
| AI 编排 | LangChain + LangGraph |
| 任务队列 | Celery + RabbitMQ |
| 缓存 | Redis |
| 数据库 | PostgreSQL |
| 对象存储 | MinIO |
| 实时通信 | Socket.IO |

## License

MIT
