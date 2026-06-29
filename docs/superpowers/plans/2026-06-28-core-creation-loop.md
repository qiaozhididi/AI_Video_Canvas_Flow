# 核心创作闭环（视频预览 + 时间轴播放）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通「工作流执行 → 节点输出 → 时间轴片段 → 视频预览播放」主链路，让用户能看到创作成果。

**Architecture:** 前端纯改造为主。timelineStore 增加 requestAnimationFrame 播放循环；VideoPreview 接入选中节点 outputArtifacts 并支持双向联动（seekTo 同步 + timeupdate 回写）；PropertyPanelWithHistory 扩展 outputArtifacts 展示并加「加入时间轴」按钮。不涉及后端改动，timelineStore 持久化留待后续阶段。

**Tech Stack:** React 18 + TypeScript + Zustand + video.js + requestAnimationFrame

## Global Constraints

- 前端必须使用 Vite + React 18 + TypeScript
- 状态管理使用 Zustand stores，单向依赖（避免循环依赖）
- VideoPreview 基于 video.js（已实现，props `{ src?, poster? }`）
- Artifact 类型：`{ id, type: 'image'|'video'|'audio', url, filename, size, metadata? }`（见 `frontend/src/types/canvas.ts:31-38`）
- CanvasNodeData.outputArtifacts: `Artifact[]`（见 `frontend/src/types/canvas.ts:41-50`）
- timelineStore 已有 `play/pause/seekTo/setCurrentTime/addClip/moveClip/resizeClip` actions（见 `frontend/src/stores/timelineStore.ts`）
- 相对路径 URL（不以 http 开头）需加 `/api/v1/media/` 前缀；外部 URL（http/https 开头）直接使用
- Git commit message 必须用中文简短描述
- 不涉及后端改动，不涉及数据库迁移
- timelineStore 持久化不在本计划范围内（P0 聚焦播放循环 + 预览接线 + 联动）

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/stores/timelineStore.ts` | 修改 | 增加 rAF 播放循环 |
| `frontend/src/components/preview/VideoPreview.tsx` | 修改 | 支持 currentTime 跳转 + onTimeUpdate 回调 |
| `frontend/src/pages/Editor.tsx` | 修改 | VideoPreview 接入选中节点输出 + 双向联动 props + PropertyPanelWithHistory 加「加入时间轴」按钮 |
| `frontend/verify_core_loop.md` | 新建 | 端到端验证清单 |

---

### Task 1: timelineStore 播放循环（rAF）

**Files:**
- Modify: `frontend/src/stores/timelineStore.ts`

**Interfaces:**
- Produces: `play()` 启动 rAF 循环推进 `data.currentTime`；`pause()` 取消 rAF；`seekTo()` 在播放时重置时间戳避免跳变。对外 API 签名不变。

**背景**：当前 `play()` 仅 `set({ isPlaying: true })`，无 rAF 循环，播放头不动。需要用 requestAnimationFrame 每帧根据真实时间戳差值推进 currentTime，到 duration 自动 pause。

- [ ] **Step 1: 修改 timelineStore.ts，增加 rAF 播放循环**

在文件顶部 import 后，增加模块级变量（不暴露到 state，避免无关渲染）：

```typescript
// 模块级 rAF 状态（不放入 Zustand state，避免每帧触发组件重渲染）
let rAFId: number | null = null;
let lastTimestamp: number | null = null;
```

替换 `play` 和 `pause` 实现，并修改 `seekTo` 在播放时重置时间戳：

```typescript
  play: () => {
    set({ isPlaying: true });
    lastTimestamp = null;
    const tick = (timestamp: number) => {
      const state = useTimelineStore.getState();
      if (!state.isPlaying) return;

      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      const delta = (timestamp - lastTimestamp) / 1000; // ms → s
      lastTimestamp = timestamp;

      const nextTime = state.data.currentTime + delta;
      if (nextTime >= state.data.duration) {
        // 播放到末尾自动停止
        set((s) => ({
          data: { ...s.data, currentTime: s.data.duration },
          isPlaying: false,
        }));
        rAFId = null;
        lastTimestamp = null;
        return;
      }

      set((s) => ({
        data: { ...s.data, currentTime: nextTime },
      }));
      rAFId = requestAnimationFrame(tick);
    };
    rAFId = requestAnimationFrame(tick);
  },

  pause: () => {
    if (rAFId !== null) {
      cancelAnimationFrame(rAFId);
      rAFId = null;
    }
    lastTimestamp = null;
    set({ isPlaying: false });
  },

  seekTo: (time) => {
    // 播放中 seek 重置时间戳，避免下一帧 delta 跳变
    lastTimestamp = null;
    set((state) => ({
      data: { ...state.data, currentTime: Math.max(0, Math.min(time, state.data.duration)) },
    }));
  },
```

注意：`tick` 内部用 `useTimelineStore.getState()` 读取最新 state（避免闭包陈旧），用 `set()` 更新。

- [ ] **Step 2: 运行 tsc 验证类型**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: EXIT_CODE=0，无错误

- [ ] **Step 3: 手动验证播放循环**

启动前端 `cd frontend && pnpm dev --port 5174`，浏览器打开编辑器，展开时间轴，点击播放按钮，观察播放头是否从 0 向 duration 推进，到末尾自动停止。再点播放→暂停，确认暂停后播放头不动。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/timelineStore.ts
git commit -m "feat(timeline): 新增 rAF 播放循环推进 currentTime"
```

---

### Task 2: VideoPreview 接入选中节点输出

**Files:**
- Modify: `frontend/src/pages/Editor.tsx`

**Interfaces:**
- Consumes: `canvasStore.selectedNodeId` + `canvasStore.nodes`（取选中节点的 outputArtifacts）
- Produces: 计算 `previewUrl` 传给 `<VideoPreview src={previewUrl} />`

**背景**：`Editor.tsx:141` `<VideoPreview />` 无 props，工作流输出存在 `node.data.outputArtifacts` 但未传入。需要订阅选中节点，取第一个 video/image artifact 的 url，处理相对路径后传给 VideoPreview。

- [ ] **Step 1: 在 Editor.tsx 计算 previewUrl**

在 Editor 组件内（`function Editor()` 内），增加订阅 selectedNodeId + nodes 并计算 previewUrl 的逻辑。找到现有的 `const { nodes, edges, ... } = useCanvasStore();` 附近，追加：

```typescript
  // 计算视频预览 URL：订阅选中节点的 outputArtifacts
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const previewUrl = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node || !node.data.outputArtifacts.length) return undefined;
    // 优先 video，其次 image（VideoPreview 也能展示图片但语义上优先 video）
    const videoArt = node.data.outputArtifacts.find((a) => a.type === 'video');
    const imageArt = node.data.outputArtifacts.find((a) => a.type === 'image');
    const artifact = videoArt || imageArt;
    if (!artifact) return undefined;
    // 相对路径加 /api/v1/media/ 前缀；外部 URL 直接用
    if (artifact.url.startsWith('http://') || artifact.url.startsWith('https://')) {
      return artifact.url;
    }
    return `/api/v1/media/${artifact.url.replace(/^\//, '')}`;
  }, [selectedNodeId, nodes]);
```

注意：`useMemo` 需确保已 import（检查 Editor.tsx 顶部 import）。

- [ ] **Step 2: 传 previewUrl 给 VideoPreview**

找到 `<VideoPreview />` 调用处（约第 141 行），改为：

```tsx
          {showPreview && (
            <div className="w-80 border-l border-canvas-border p-2">
              <VideoPreview src={previewUrl} />
            </div>
          )}
```

- [ ] **Step 3: 运行 tsc 验证**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: EXIT_CODE=0

- [ ] **Step 4: 手动验证预览接线**

启动前端，执行工作流（或用已有 completed 节点），选中一个有 outputArtifacts 的节点，确认右侧 VideoPreview 显示输出（图片或视频）。切换选中节点，预览应跟随切换。无选中节点时显示「暂无视频预览」。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Editor.tsx
git commit -m "feat(preview): VideoPreview 接入选中节点 outputArtifacts"
```

---

### Task 3: 时间轴 ↔ 视频预览双向联动

**Files:**
- Modify: `frontend/src/components/preview/VideoPreview.tsx`
- Modify: `frontend/src/pages/Editor.tsx`

**Interfaces:**
- Consumes: timelineStore.data.currentTime（时间轴播放头位置）
- Produces: VideoPreview 接收 `currentTime` 跳转播放位置；通过 `onTimeUpdate` 回调把播放进度写回 timelineStore

**背景**：VideoPreview 当前只接收 `src/poster`，无法被时间轴 seekTo 跳转，也无法把播放进度回写时间轴。需要扩展 props 支持 `currentTime`（跳转）和 `onTimeUpdate`（回写）。

- [ ] **Step 1: 扩展 VideoPreview props 支持 currentTime 和 onTimeUpdate**

修改 `frontend/src/components/preview/VideoPreview.tsx`：

```typescript
import { useRef, useEffect } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';

interface VideoPreviewProps {
  src?: string;
  poster?: string;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
}

export default function VideoPreview({ src, poster, currentTime, onTimeUpdate }: VideoPreviewProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  // 创建/更新 player（src/poster 变化时）
  useEffect(() => {
    if (!videoRef.current) return;

    if (!playerRef.current) {
      const videoElement = document.createElement('video');
      videoElement.classList.add('video-js', 'vjs-big-play-centered');
      videoRef.current.appendChild(videoElement);

      playerRef.current = videojs(videoElement, {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: false,
        responsive: true,
        poster: poster || '',
        sources: src ? [{ src, type: 'video/mp4' }] : [],
      });

      // 注册 timeupdate 回调（播放进度变化时回写）
      playerRef.current.on('timeupdate', () => {
        const time = playerRef.current?.currentTime();
        if (typeof time === 'number' && onTimeUpdate) {
          onTimeUpdate(time);
        }
      });
    } else {
      if (src) {
        playerRef.current.src({ src, type: 'video/mp4' });
      }
      if (poster) {
        playerRef.current.poster(poster);
      }
    }

    return () => {
      // 组件卸载时不销毁 player，避免重复创建
    };
  }, [src, poster, onTimeUpdate]);

  // currentTime 变化时跳转播放位置（避免回环：onTimeUpdate 触发的 currentTime 变化不再触发跳转）
  useEffect(() => {
    if (playerRef.current && typeof currentTime === 'number') {
      const playerTime = playerRef.current.currentTime();
      // 仅当差异 > 0.3s 时跳转，避免 timeupdate 回调造成的微小回环
      if (Math.abs(playerTime - currentTime) > 0.3) {
        playerRef.current.currentTime(currentTime);
      }
    }
  }, [currentTime]);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden">
      {src ? (
        <div ref={videoRef} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-hover flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">暂无视频预览</p>
            <p className="text-xs text-slate-600">执行工作流后在此预览</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

**关键点**：
- `timeupdate` 事件回调通过 `onTimeUpdate` 把播放进度回写
- `currentTime` 变化时跳转，但用 0.3s 阈值避免 `timeupdate` 回写造成的微小回环
- `onTimeUpdate` 加入 useEffect 依赖数组（用 useCallback 稳定引用，见 Step 2）

- [ ] **Step 2: Editor.tsx 传入 currentTime 和 onTimeUpdate**

在 Editor 组件内，增加 timelineStore 订阅并传给 VideoPreview：

```typescript
  // 时间轴 ↔ 预览联动
  const timelineCurrentTime = useTimelineStore((s) => s.data.currentTime);
  const setTimelineCurrentTime = useTimelineStore((s) => s.setCurrentTime);
  const handleTimeUpdate = useCallback((time: number) => {
    setTimelineCurrentTime(time);
  }, [setTimelineCurrentTime]);
```

注意：需在 Editor.tsx 顶部 import `useTimelineStore`（如果尚未 import）。

修改 VideoPreview 调用：

```tsx
          {showPreview && (
            <div className="w-80 border-l border-canvas-border p-2">
              <VideoPreview
                src={previewUrl}
                currentTime={timelineCurrentTime}
                onTimeUpdate={handleTimeUpdate}
              />
            </div>
          )}
```

- [ ] **Step 3: 运行 tsc 验证**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: EXIT_CODE=0

- [ ] **Step 4: 手动验证双向联动**

启动前端：
1. 时间轴 → 预览：点击时间轴不同位置，VideoPreview 播放头跳转到对应位置（需有视频源）
2. 预览 → 时间轴：播放 VideoPreview，观察时间轴播放头是否跟随移动

若无真实视频源，可用一个 completed 的 ai_text2img 节点（图片输出）验证 currentTime 跳转逻辑（图片不会触发 timeupdate，但 seekTo 仍应生效）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/preview/VideoPreview.tsx frontend/src/pages/Editor.tsx
git commit -m "feat(preview): 时间轴与视频预览双向联动"
```

---

### Task 4: 「加入时间轴」按钮 + 工作流输出 → 时间轴片段

**Files:**
- Modify: `frontend/src/pages/Editor.tsx`（PropertyPanelWithHistory 函数内）

**Interfaces:**
- Consumes: `canvasStore.selectedNodeId` + `nodes`（取选中节点 outputArtifacts）
- Consumes: `timelineStore.data.currentTime`（片段起始位置）+ `timelineStore.addClip`
- Produces: 点击按钮把 artifact 转成 Clip 加入对应类型轨道

**背景**：PropertyPanelWithHistory 当前 outputArtifacts 展示简陋（只显示「输出: N 个资产」），且无「加入时间轴」入口。需要扩展展示每个 artifact，并加按钮把 artifact 加入时间轴。

- [ ] **Step 1: 扩展 PropertyPanelWithHistory 的 outputArtifacts 展示**

在 `frontend/src/pages/Editor.tsx` 的 `PropertyPanelWithHistory` 函数内，找到现有的 outputArtifacts 展示（约第 450-454 行）：

```tsx
            {data.outputArtifacts.length > 0 && (
              <div className="mt-1 text-xs text-slate-400">
                输出: {data.outputArtifacts.length} 个资产
              </div>
            )}
```

替换为：

```tsx
            {data.outputArtifacts.length > 0 && (
              <div className="mt-2 space-y-1">
                <label className="text-xs text-slate-500 uppercase tracking-wider">输出资产</label>
                {data.outputArtifacts.map((artifact) => (
                  <div key={artifact.id} className="flex items-center gap-2 px-2 py-1 bg-canvas-bg rounded-md">
                    <span className="text-xs text-slate-400 uppercase">{artifact.type}</span>
                    <span className="text-xs text-slate-300 truncate flex-1">{artifact.filename}</span>
                    <button
                      onClick={() => handleAddToTimeline(artifact)}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-neon-blue hover:bg-neon-blue/10 rounded transition-colors"
                      title="加入时间轴"
                    >
                      <Plus className="w-3 h-3" />
                      加入时间轴
                    </button>
                  </div>
                ))}
              </div>
            )}
```

- [ ] **Step 2: 实现 handleAddToTimeline 函数**

在 `PropertyPanelWithHistory` 函数内（hooks 之后，early return 之后），增加：

```typescript
  const addClip = useTimelineStore((s) => s.addClip);
  const timelineTracks = useTimelineStore((s) => s.data.tracks);
  const timelineCurrentTime = useTimelineStore((s) => s.data.currentTime);

  const handleAddToTimeline = (artifact: Artifact) => {
    // 按 artifact 类型匹配轨道：video → video 轨，audio → audio 轨，image → video 轨（图片作为静态帧）
    const trackType: TrackType = artifact.type === 'audio' ? 'audio' : 'video';
    const targetTrack = timelineTracks.find((t) => t.type === trackType);
    if (!targetTrack) {
      console.warn(`[Timeline] 未找到 ${trackType} 类型轨道，请先添加`);
      return;
    }

    // 默认时长：video/audio 5s，image 3s
    const duration = artifact.type === 'image' ? 3 : 5;
    const clip: Clip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trackId: targetTrack.id,
      start: timelineCurrentTime,
      end: timelineCurrentTime + duration,
      mediaUrl: artifact.url.startsWith('http') ? artifact.url : `/api/v1/media/${artifact.url.replace(/^\//, '')}`,
      label: data.label,
      color: undefined,
    };
    addClip(targetTrack.id, clip);
  };
```

注意：需在 Editor.tsx 顶部 import `Artifact`、`Clip`、`TrackType` 类型：

```typescript
import type { Artifact } from '@/types/canvas';
import type { Clip, TrackType } from '@/types/timeline';
```

并确保 `useTimelineStore` 已 import。

- [ ] **Step 3: 运行 tsc 验证**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: EXIT_CODE=0

- [ ] **Step 4: 手动验证加入时间轴**

启动前端：
1. 执行工作流（或选中已有 completed 节点）
2. 在属性面板看到 outputArtifacts 列表 + 「加入时间轴」按钮
3. 点击按钮，时间轴对应轨道出现新片段（起始位置为当前播放头）
4. 点击时间轴片段，VideoPreview 跳转到片段起始位置

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Editor.tsx
git commit -m "feat(timeline): 属性面板新增「加入时间轴」按钮"
```

---

### Task 5: 端到端验证

**Files:**
- Create: `frontend/verify_core_loop.md`

**背景**：本阶段无后端改动，验证以前端 tsc + 人工浏览器验证为主。编写验证清单文档供人工执行。

- [ ] **Step 1: 创建验证清单文档**

创建 `frontend/verify_core_loop.md`：

```markdown
# 核心创作闭环验证清单

**验证时间**：2026-06-28
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
| 1 | 展开时间轴，点击播放按钮，播放头从 0 向 duration 推进 | ☐ |
| 2 | 播放到 duration 末尾自动停止，isPlaying=false | ☐ |
| 3 | 播放中点击暂停，播放头立即停止 | ☐ |
| 4 | 播放中点击时间轴不同位置（seekTo），播放头跳转后继续推进（无跳变） | ☐ |

### Task 2: VideoPreview 接入选中节点输出
| # | 验证点 | 结果 |
|---|--------|------|
| 5 | 无选中节点时，VideoPreview 显示「暂无视频预览」 | ☐ |
| 6 | 选中无 outputArtifacts 的节点，VideoPreview 仍显示占位 | ☐ |
| 7 | 执行工作流后选中 completed 节点，VideoPreview 显示输出（图片/视频） | ☐ |
| 8 | 切换选中节点，VideoPreview 跟随切换输出 | ☐ |
| 9 | 相对路径 URL 正确加 /api/v1/media/ 前缀（Network 面板验证 200） | ☐ |

### Task 3: 时间轴 ↔ 视频预览双向联动
| # | 验证点 | 结果 |
|---|--------|------|
| 10 | 点击时间轴不同位置，VideoPreview 播放头跳转到对应位置 | ☐ |
| 11 | 播放 VideoPreview，时间轴播放头跟随移动 | ☐ |
| 12 | 无视频源（仅图片）时，seekTo 仍生效（图片不触发 timeupdate） | ☐ |

### Task 4: 加入时间轴按钮
| # | 验证点 | 结果 |
|---|--------|------|
| 13 | 选中无 outputArtifacts 的节点，属性面板不显示「输出资产」区域 | ☐ |
| 14 | 选中有 outputArtifacts 的节点，显示每个 artifact + 「加入时间轴」按钮 | ☐ |
| 15 | 点击「加入时间轴」，对应类型轨道出现新片段 | ☐ |
| 16 | 片段起始位置 = 当前播放头位置 | ☐ |
| 17 | 片段时长：image 3s，video/audio 5s | ☐ |
| 18 | 点击时间轴新片段，VideoPreview 跳转到片段起始位置 | ☐ |

### 端到端主链路
| # | 验证点 | 结果 |
|---|--------|------|
| 19 | 完整流程：执行工作流 → 选中节点看预览 → 加入时间轴 → 播放时间轴 → VideoPreview 同步 | ☐ |

## 前端类型检查
- [ ] `cd frontend && pnpm tsc --noEmit` EXIT_CODE=0

## 结论
- 通过验证点数：__ / 19
- 前端 tsc：☐ PASS / ☐ FAIL
- 阻塞性问题：（列出，无则填「无」）
```

- [ ] **Step 2: 运行 tsc 最终验证**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: EXIT_CODE=0

- [ ] **Step 3: 人工执行验证清单**

按 `frontend/verify_core_loop.md` 逐项验证，记录结果。

- [ ] **Step 4: Commit 验证清单**

```bash
git add frontend/verify_core_loop.md
git commit -m "test: 新增核心创作闭环端到端验证清单"
```

---

## Self-Review

**1. Spec coverage**：
- P0 主链路（VideoPreview 接工作流输出 + timelineStore 播放循环 + 时间轴↔预览联动）→ Task 1/2/3 覆盖 ✅
- 「加入时间轴」按钮（工作流输出 → 时间轴片段）→ Task 4 覆盖 ✅
- 端到端验证 → Task 5 覆盖 ✅
- timelineStore 持久化 → 明确排除（P0 不含）✅
- 时间轴片段 resize 手柄 → 未覆盖（属于 P1 增强，本计划不含）✅
- render_tasks 真实视频输出 → 未覆盖（属于 P1，本计划不含）✅

**2. Placeholder scan**：无 TBD/TODO/「类似 Task N」等占位符，所有代码步骤均有完整代码 ✅

**3. Type consistency**：
- `Artifact` 类型：`{ id, type: 'image'|'video'|'audio', url, filename, size, metadata? }`（Task 2/4 一致）✅
- `Clip` 类型：`{ id, trackId, start, end, mediaUrl, label, color? }`（Task 4 一致）✅
- `TrackType`：`'video'|'audio'|'subtitle'|'effect'`（Task 4 一致）✅
- VideoPreview props：`{ src?, poster?, currentTime?, onTimeUpdate? }`（Task 2 传 src，Task 3 扩展 currentTime/onTimeUpdate，一致）✅
- timelineStore API：`play/pause/seekTo/setCurrentTime/addClip`（Task 1/3/4 一致）✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-28-core-creation-loop.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
