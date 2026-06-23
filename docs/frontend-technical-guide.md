# AI Canvas Flow — 前端开发技术文档

## 1. 项目概述

AI Canvas Flow 是一个可视化 AI 视频创作工作流平台，用户通过拖拽节点编排 AI 推理流程（文生图、图生视频、语音合成等），结合时间轴编辑器完成视频创作。

## 2. 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 构建工具 | Vite | 6.x | 开发服务器、构建打包 |
| UI 框架 | React | 18.x | 组件化 UI 开发 |
| 类型系统 | TypeScript | 5.8.x | 静态类型检查 |
| 画布引擎 | @xyflow/react (React Flow) | 12.x | 节点编排画布 |
| 状态管理 | Zustand | 5.x | 轻量级全局状态 |
| 路由 | React Router DOM | 7.x | SPA 路由管理 |
| 样式方案 | Tailwind CSS | 3.4.x | 原子化 CSS |
| 图标 | Lucide React | 0.511.x | 图标库 |
| 视频播放 | Video.js | 8.x | 视频预览播放器 |
| 视频处理 | @ffmpeg/ffmpeg | 0.12.x | 前端视频处理 |
| 拖拽交互 | @dnd-kit | 6.x | 通用拖拽能力 |
| 实时通信 | Socket.IO Client | 4.x | 协作 WebSocket 通信 |
| 工具库 | clsx + tailwind-merge | — | 条件样式合并 |

## 3. 项目架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │                    React App                       │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │  Pages   │  │Components│  │    Stores        │  │  │
│  │  │ (路由页) │  │ (UI组件) │  │ (Zustand 状态)   │  │  │
│  │  └────┬────┘  └────┬─────┘  └────────┬─────────┘  │  │
│  │       │            │                  │             │  │
│  │  ┌────┴────────────┴──────────────────┴─────────┐  │  │
│  │  │                  Hooks                         │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │              Types (TypeScript)                │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │              localStorage (自动保存快照)             │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                    WebSocket / HTTP
                          │
┌─────────────────────────────────────────────────────────┐
│                   Backend (规划中)                       │
│         FastAPI + LangChain + Celery + Redis            │
└─────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
frontend/src/
├── App.tsx                    # 根组件 + 路由配置
├── main.tsx                   # 入口文件
├── index.css                  # 全局样式 + Tailwind 指令
│
├── components/                # UI 组件
│   ├── Layout.tsx             # 主布局（侧边导航 + Outlet）
│   ├── EditorLayout.tsx       # 编辑器布局（工具栏 + 自动保存 + 快捷键）
│   ├── canvas/                # 画布相关
│   │   ├── Canvas.tsx         # React Flow 画布容器
│   │   └── CanvasNode.tsx     # 自定义节点组件（5类16种）
│   ├── panels/                # 面板组件
│   │   ├── NodePanel.tsx      # 左侧节点面板（搜索 + 分类 + 拖拽/点击添加）
│   │   └── PropertyPanel.tsx  # 右侧属性面板
│   ├── preview/               # 预览组件
│   │   └── VideoPreview.tsx   # video.js 视频预览
│   └── timeline/              # 时间轴组件
│       └── Timeline.tsx       # 多轨道时间轴编辑器
│
├── pages/                     # 页面组件
│   ├── Home.tsx               # 工作台首页
│   ├── Editor.tsx             # 工作流编辑器（核心页面）
│   ├── MediaLibrary.tsx       # 媒体库
│   ├── RenderCenter.tsx       # 渲染中心
│   ├── Templates.tsx          # 模板市场
│   └── Settings.tsx           # 用户设置
│
├── stores/                    # Zustand 状态管理
│   ├── canvasStore.ts         # 画布状态（节点、边、选中）
│   ├── timelineStore.ts       # 时间轴状态（轨道、片段、播放）
│   ├── projectStore.ts        # 项目状态（项目列表、当前项目）
│   ├── authStore.ts           # 认证状态
│   ├── historyStore.ts        # 撤销/重做系统（分支式操作历史树）
│   └── autoSaveStore.ts       # 自动保存与崩溃恢复
│
├── types/                     # TypeScript 类型定义
│   ├── canvas.ts              # 画布节点/边类型、节点模板、5类16种子类型
│   ├── timeline.ts            # 时间轴轨道/片段类型
│   ├── project.ts             # 项目类型
│   ├── history.ts             # 操作历史类型（15种操作 + 分支树 + 快照）
│   └── api.ts                 # API 接口类型
│
├── hooks/                     # 自定义 Hooks
│   └── useTheme.ts            # 主题切换
│
├── utils/                     # 工具函数
│   └── mockData.ts            # Mock 数据（9节点+7边完整工作流）
│
└── lib/
    └── utils.ts               # 通用工具函数（cn 样式合并）
```

## 4. 路由架构

```
/                        → Layout (侧边导航) > Home
/media                   → Layout > MediaLibrary
/render                  → Layout > RenderCenter
/templates               → Layout > Templates
/settings                → Layout > Settings
/editor/:projectId       → EditorLayout (工具栏+自动保存+快捷键) > Editor
```

**双层布局设计**：
- `Layout`：通用侧边导航布局，用于工作台、媒体库等常规页面
- `EditorLayout`：编辑器专用全屏布局，集成撤销/重做工具栏、自动保存生命周期、崩溃恢复对话框、全局快捷键

## 5. 状态管理架构

### 5.1 Store 职责划分

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ canvasStore  │     │timelineStore │     │ projectStore │
│              │     │              │     │              │
│ nodes[]      │     │ data.tracks[]│     │ projects[]   │
│ edges[]      │     │ data.clips[] │     │ currentProj  │
│ selectedId   │     │ playhead     │     │              │
│              │     │ isPlaying    │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────┬───────────┘                    │
                │                                │
       ┌────────┴────────┐              ┌───────┴────────┐
       │  historyStore   │              │  autoSaveStore  │
       │                 │              │                 │
       │ tree.branches[] │              │ snapshots[]     │
       │ tree.pointer    │              │ isDirty         │
       │ canUndo/Redo    │              │ lastSavedAt     │
       │ isRecording     │              │ debounceTimer   │
       │ pendingMerge    │              │ intervalId      │
       └─────────────────┘              └─────────────────┘
```

### 5.2 historyStore — 撤销/重做系统

**核心设计**：
- **分支式操作历史树**（`HistoryTree`）：非传统线性栈，支持撤销后执行新操作时保留分支
- **15 种操作类型**：覆盖画布（8种）和时间轴（7种）全部操作
- **操作合并窗口**：500ms 内同类操作自动合并（如连续拖拽节点）
- **最大栈深度**：100 步
- **录制控制**：`pauseRecording` / `resumeRecording`，避免逆向操作被记录
- **跨模块协同**：撤销画布操作时同步回退时间轴影响

**操作类型一览**：

| 模块 | 操作类型 | 说明 |
|------|----------|------|
| 画布 | `add_node` | 添加节点 |
| 画布 | `remove_node` | 删除节点（含关联边） |
| 画布 | `move_node` | 移动节点位置 |
| 画布 | `update_node_data` | 修改节点参数 |
| 画布 | `add_edge` / `remove_edge` | 添加/删除连线 |
| 画布 | `batch_set_nodes` / `batch_set_edges` | 批量更新 |
| 时间轴 | `add_track` / `remove_track` | 添加/删除轨道 |
| 时间轴 | `add_clip` / `remove_clip` | 添加/删除片段 |
| 时间轴 | `move_clip` / `resize_clip` | 移动/调整片段 |
| 时间轴 | `toggle_track_*` | 切换轨道状态 |

**逆向/正向执行器**：`applyReverse` / `applyForward` — 每种操作类型都有完整的双向执行逻辑，直接操作 `canvasStore` 和 `timelineStore`。

### 5.3 autoSaveStore — 自动保存与崩溃恢复

**双层保存策略**：
1. **防抖保存**：操作后 2 秒无新操作则保存（`DEBOUNCE_DELAY = 2000ms`）
2. **定时兜底**：每 30 秒检查脏状态并保存（`AUTOSAVE_INTERVAL = 30000ms`）

**快照管理**：
- 快照存储到 `localStorage`，key 为 `ai-canvas-flow-autosave`
- 自动快照最多保留 5 个，手动命名快照不受限制
- 快照内容：完整深拷贝的 nodes + edges + timelineData

**崩溃恢复**：
- 页面加载时 `checkRecovery()` 检测快照时间是否晚于项目最后保存时间
- 如有可恢复快照，弹出恢复对话框，用户可选择恢复或丢弃

## 6. 画布节点系统

### 6.1 节点类型体系

```
NodeType (5类)
├── input (输入)
│   ├── text_input      文本输入
│   ├── image_input     图片输入
│   └── audio_input     音频输入
├── ai_inference (AI 推理)
│   ├── text_to_image   文生图
│   ├── image_to_video  图生视频
│   └── text_to_speech  文生语音
├── processing (处理)
│   ├── upscale         高清放大
│   ├── style_transfer  风格化
│   ├── remove_bg       抠图
│   └── outpaint        扩图
├── control (控制)
│   ├── if_else         条件分支
│   ├── loop            循环
│   └── merge           合并
└── output (输出)
    ├── video_output    视频输出
    ├── image_output    图片输出
    └── audio_output    音频输出
```

### 6.2 节点状态机

```
idle → pending → running → completed
                  │              │
                  └→ failed      └→ (可重新执行)
```

每个节点有 `status` 和 `progress` 字段，支持进度条和状态动画。

## 7. 设计系统

### 7.1 色彩体系

| Token | 色值 | 用途 |
|-------|------|------|
| `canvas-bg` | `#0F0F14` | 主背景 |
| `canvas-panel` | `#1A1A2E` | 面板背景 |
| `canvas-border` | `#2A2A3E` | 边框 |
| `canvas-hover` | `#252540` | 悬停态 |
| `neon-purple` | `#7C3AED` | 主强调色 |
| `neon-blue` | `#3B82F6` | 辅助强调色 |
| `neon-cyan` | `#06B6D4` | 信息色 |
| `status-success` | `#22C55E` | 成功/完成 |
| `status-warning` | `#EAB308` | 警告/未保存 |
| `status-error` | `#EF4444` | 错误/失败 |
| `status-running` | `#8B5CF6` | 运行中 |

### 7.2 字体

- **Display**：Space Grotesk — 标题、节点名称
- **Body**：DM Sans — 正文、参数标签

### 7.3 动画

- `pulse-neon`：节点运行中状态脉冲
- `glow`：选中节点发光效果

## 8. 快捷键

| 快捷键 | 操作 | 作用域 |
|--------|------|--------|
| `Ctrl+Z` | 撤销 | 编辑器 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 | 编辑器 |
| `Ctrl+Shift+H` | 打开操作历史面板 | 编辑器 |
| `Ctrl+S` | 保存项目 | 编辑器 |
| `Delete` | 删除选中节点 | 编辑器 |
| `Space` | 播放/暂停时间轴 | 编辑器 |

## 9. 开发规范

### 9.1 命名规范

- **组件**：PascalCase（`CanvasNode.tsx`）
- **Store**：camelCase + Store 后缀（`canvasStore.ts`）
- **类型**：PascalCase（`CanvasNode`、`HistoryAction`）
- **类型文件**：camelCase（`canvas.ts`）
- **工具函数**：camelCase（`mockData.ts`）

### 9.2 导入规范

- 使用 `@/` 路径别名指向 `src/`
- 禁止使用 `require()`，统一使用 ESM `import`
- 类型导入使用 `import type`

### 9.3 状态管理规范

- Store 之间避免循环依赖
- 需要跨 Store 操作时，通过 `xxxStore.getState()` 直接获取状态
- 操作方法中手动调用 `markDirty()` 触发自动保存，禁止在 `useEffect` 中监听 store 状态触发保存（会导致无限循环）

### 9.4 性能规范

- 使用 Zustand selector 避免不必要的重渲染：`useStore((s) => s.specificField)`
- `useEffect` 必须声明依赖数组，禁止省略
- 大列表使用虚拟滚动
- 快照深拷贝使用 `JSON.parse(JSON.stringify())`

## 10. 构建与部署

### 10.1 开发

```bash
pnpm dev          # 启动开发服务器 (http://localhost:5173)
pnpm check        # TypeScript 类型检查
pnpm lint         # ESLint 检查
```

### 10.2 构建

```bash
pnpm build        # tsc 类型检查 + vite 构建
pnpm preview      # 预览构建产物
```

### 10.3 构建配置

- **Source Map**：`sourcemap: 'hidden'`（生产环境隐藏，开发环境可用）
- **路径别名**：`@/` → `src/`（通过 `vite-tsconfig-paths` 插件）
- **React Dev Locator**：开发环境组件定位插件

## 11. 后端技术方案（规划）

| 组件 | 技术 | 用途 |
|------|------|------|
| Web 框架 | FastAPI | REST API + WebSocket |
| AI 编排 | LangChain + LangGraph | 工作流执行引擎 |
| 任务队列 | Celery + RabbitMQ | 异步 AI 推理任务 |
| 缓存 | Redis | 会话、中间状态快照 |
| 数据库 | PostgreSQL | 项目、用户、素材元数据 |
| 对象存储 | MinIO | 素材文件、生成产物 |
| 实时通信 | Socket.IO | 协作编辑、任务状态推送 |
