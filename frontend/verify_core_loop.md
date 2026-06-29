# 核心创作闭环验证清单

**验证时间**：2026-06-29
**验证分支**：feature/core-creation-loop
**前端服务**：`pnpm dev --port 5174`
**后端服务**：`uvicorn --reload --port 8000`（需运行以支持工作流执行）

## 前置条件
- 后端运行中，/health 返回 200
- 至少一个 AI Provider + Model 已配置（或用默认 SeedReam）
- 已登录用户，已创建/打开一个项目

## 验证点

### Task 1: timelineStore 播放循环
| # | 验证点 | 结果 |
|---|--------|------|
| 1 | 展开时间轴，点击播放按钮，播放头从 0 向 duration 推进 | ✅ 通过 |
| 2 | 播放到 duration 末尾自动停止，isPlaying=false | ✅ 通过 |
| 3 | 播放中点击暂停，播放头立即停止 | ✅ 基本通过 |
| 4 | 播放中点击时间轴不同位置（seekTo），播放头跳转后继续推进（无跳变） | ✅ 通过 |

### Task 2: VideoPreview 接入选中节点输出
| # | 验证点 | 结果 |
|---|--------|------|
| 5 | 无选中节点时，VideoPreview 显示「暂无视频预览」 | ✅ 通过 |
| 6 | 选中无 outputArtifacts 的节点，VideoPreview 仍显示占位 | ✅ 通过 |
| 7 | 执行工作流后选中 completed 节点，VideoPreview 显示输出（图片/视频） | ⏳ 待人工 |
| 8 | 切换选中节点，VideoPreview 跟随切换输出 | ⏳ 待人工 |
| 9 | 相对路径 URL 正确加 /api/v1/media/ 前缀（Network 面板验证 200） | ⏳ 待人工 |

### Task 3: 时间轴 ↔ 视频预览双向联动
| # | 验证点 | 结果 |
|---|--------|------|
| 10 | 点击时间轴不同位置，VideoPreview 播放头跳转到对应位置 | ⏳ 待人工 |
| 11 | 播放 VideoPreview，时间轴播放头跟随移动 | ⏳ 待人工 |
| 12 | 无视频源（仅图片）时，seekTo 仍生效（图片不触发 timeupdate） | ⏳ 待人工 |

### Task 4: 加入时间轴按钮
| # | 验证点 | 结果 |
|---|--------|------|
| 13 | 选中无 outputArtifacts 的节点，属性面板不显示「输出资产」区域 | ⏳ 待人工 |
| 14 | 选中有 outputArtifacts 的节点，显示每个 artifact + 「加入时间轴」按钮 | ⏳ 待人工 |
| 15 | 点击「加入时间轴」，对应类型轨道出现新片段 | ⏳ 待人工 |
| 16 | 片段起始位置 = 当前播放头位置 | ⏳ 待人工 |
| 17 | 片段时长：image 3s，video/audio 5s | ⏳ 待人工 |
| 18 | 点击时间轴新片段，VideoPreview 跳转到片段起始位置 | ⏳ 待人工 |

### 端到端主链路
| # | 验证点 | 结果 |
|---|--------|------|
| 19 | 完整流程：执行工作流 → 选中节点看预览 → 加入时间轴 → 播放时间轴 → VideoPreview 同步 | ⏳ 待人工 |

## 前端类型检查
- [x] `cd frontend && pnpm tsc --noEmit` EXIT_CODE=0 ✅

## 结论
- 通过验证点数：6 / 19（MCP 自动验证）+ 13 待人工
- 前端 tsc：✅ PASS
- 阻塞性问题：无（rAF 播放速度已修复，见下方 2026-06-29 修复后验证；#7-19 需真实工作流执行，待人工验证）


## MCP 自动化验证说明（2026-06-29）

**验证环境**：
- 后端：uvicorn 重启后健康检查 HTTP 200（3ms）
- 前端：localhost:5173
- 测试账号：verify_user / Test1234
- 测试项目：ad79268d-5b17-4a49-b738-cc7c05aac50c「验证测试项目」

**已自动化验证（6/19）**：
- #1-4 timelineStore 播放循环：点击播放→播放头推进→末尾自动停止→seekTo 跳转
- #5-6 VideoPreview 占位：无选中节点/选中无 outputArtifacts 节点时显示「暂无视频预览」

**待人工验证（13/19）**：
- #7-9 需执行真实工作流产生 outputArtifacts（需配置 AI Provider + Model）
- #10-12 需视频源验证双向联动
- #13-18 需有 outputArtifacts 的节点验证加入时间轴功能
- #19 端到端主链路

**MCP 环境限制**：
1. ~~rAF 播放速度异常快（约 80x），无法捕获中间暂停点（#3 标为基本通过）~~ → 已修复（见下方 2026-06-29 修复后验证，speed=0.999）
2. React Flow 节点选中需 MCP click 配合事件冒泡（已验证可行）
3. dispatchEvent 无法触发 React 合成事件，需用 element.click() 或 MCP click 工具

## 2026-06-29 修复后验证（rAF 播放速度优化）

**修复 commit**：c5f5d96 `fix(timeline): rAF 播放速度异常优化`
**修复内容**：timelineStore.ts `play()` 的 tick 回调中，对 rawDelta 增加 clamp `Math.max(0, Math.min(rawDelta, 0.05))`，限制单帧 delta 上限 50ms，防止页面后台/标签页切换/自动化环境导致 rAF 批量调度引起 timestamp 跳变。

**验证方法**：在单次 evaluate_script 内完成 click+await（消除 MCP 调用间隙导致的 rAF 异常），精确查找播放按钮（iconClass 含 lucide-play/pause 且无文字，排除"执行工作流"按钮）。

**验证结果**：

### #1 播放速度（核心）
| 指标 | 值 |
|------|-----|
| 起始时间 | 00:00 / 00:30 |
| 等待 2s 后 | 00:02 / 00:30 |
| 实际等待 | 2001ms |
| 时间推进 | 2s |
| **播放速度** | **0.999x** ✅ |
| 播放图标 | lucide-pause（播放中显示暂停图标） |

### #3 暂停停止
| 指标 | 值 |
|------|-----|
| 暂停时时间 | 00:02 / 00:30 |
| 等待 1s 后 | 00:02 / 00:30（未变） |
| **是否停止** | **true** ✅ |
| 暂停图标 | lucide-play（暂停后显示播放图标） |

**结论**：rAF 播放速度优化修复成功，从修复前的 15x-80x 降到 0.999x（≈1x），符合预期。#1 标为 ✅ 通过，#3 标为 ✅ 通过。


## 2026-06-29 拖拽 UI 交互优化验证

**修改文件**：`frontend/src/components/timeline/Timeline.tsx`（未 commit）
**优化内容**：统一 DragState 架构管理 move/resize-left/resize-right 三种拖拽，新增视觉反馈（cursor 锁定 + clip 高亮 ring）、吸附对齐（整数秒/播放头/其他片段边缘，8px 阈值）、拖拽时长 tooltip、Pointer Events 替代 HTML5 onDragEnd。

**验证环境**：
- 前端：localhost:5173
- 测试账号：verify_user / Test1234
- 测试项目：3b4dc32f-fae5-4e58-8310-cbec29dd3a75「rAF优化测试」
- 测试方式：React Fiber hack 访问 Zustand store 添加测试 clip + dispatchEvent PointerEvent 触发拖拽

**关键技术点**：
1. `setPointerCapture` 在 MCP 环境（`isTrusted=false`）抛 `NotFoundError`，已用 try-catch 保护，不影响拖拽（handleMove 监听在 window 上）
2. dispatchEvent PointerEvent 可触发 React 合成 onPointerDown（React 不检查 isTrusted）
3. pointerdown 与 pointermove 必须分步执行（同一次 evaluate_script 内连续 dispatch 会导致 React 事件处理未完成时 pointermove 已触发）

### 播放回归验证（拖拽优化后）

| 验证点 | 结果 |
|--------|------|
| #1 播放速度 | ✅ 通过（真实 29s 推进 29s 播放时间，速度 1.0x） |
| #2 末尾自动停止 | ✅ 通过（播放到 00:30 后 icon 变为 lucide-play，isPlaying=false） |
| #3 暂停停止 | ✅ 通过（pause() 后 isPlaying=false，时间几乎未推进） |

### 拖拽功能验证

| # | 验证点 | 结果 |
|---|--------|------|
| D1 | resize-right 拖拽：width 320→400（+80px=1s） | ✅ 通过 |
| D2 | move 拖拽：left 188→268（+80px=1s） | ✅ 通过 |
| D3 | 吸附对齐：move 到 3.975s 吸附到整数秒 4s（store.start=4） | ✅ 通过 |
| D4 | tooltip 显示：「00:06 → 00:10 (5.0s)」格式正确 | ✅ 通过 |
| D5 | cursor 锁定：拖拽中 ew-resize/grabbing，结束后恢复 "" | ✅ 通过 |
| D6 | console 错误：仅 1 个 404 资源错误（非拖拽相关） | ✅ 通过 |

### 验证细节

**resize-right**（向右拖拽右边缘 +80px）：
- 初始 width=320px（end=6s）
- 拖拽后 width=400px（end=7s）
- widthDelta=80px = 1s ✅

**move**（向右拖拽主体 +80px）：
- 初始 left=188px（start=2.35s）
- 拖拽后 left=268px（start=3.35s）
- leftDelta=80px = 1s ✅

**吸附**（move +50px，newStart=3.975s）：
- 候选点：整数秒 4s（差 0.025s = 2px < 8px 阈值）
- 吸附结果：store.data.tracks[0].clips[0].start = 4 ✅

**tooltip**（move 拖拽中）：
- 文本：「00:06 → 00:10 (5.0s)」
- 位置：left=922px, top=533px（跟随鼠标）✅

**结论**：拖拽 UI 交互优化 4 项功能（视觉反馈/吸附对齐/时长 tooltip/Pointer Events）全部验证通过，播放功能回归正常。#1-6 + D1-D6 全部 ✅ 通过。
