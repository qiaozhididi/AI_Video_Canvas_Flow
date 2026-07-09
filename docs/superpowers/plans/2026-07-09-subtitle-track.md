# 字幕轨功能完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善字幕轨功能，实现 TTS 自动字幕、手动编辑、AI 生成字幕、预览叠加和导出烧录。

**Architecture:** 扩展现有 Clip 模型新增 `subtitleText` 和 `mediaType: 'subtitle'`，在 VideoPreview 中以 HTML 覆盖层叠加字幕，后端 FFmpeg 烧录字幕到视频。

**Tech Stack:** React, TypeScript, Zustand, video.js, FastAPI, Celery, FFmpeg

## Global Constraints

- `Clip.mediaType` 必须包含 `'subtitle'` 值
- 字幕片段的 `subtitleText` 存放实际字幕文本，`label` 存放显示名称
- `usePreviewContent` 过滤条件改为 `c.mediaUrl || c.subtitleText`
- VideoPreview 字幕覆盖层使用 HTML 绝对定位叠加（不用 video.js VTT track）
- 导出时 FFmpeg 使用 `-vf subtitles=temp.srt` 烧录字幕
- 后端 AI 字幕接口 `POST /api/v1/ai/generate-subtitles`
- Git commit 消息用简短中文

---

### Task 1: Clip 数据模型扩展 + TTS 字幕片段修正

**Files:**
- Modify: `frontend/src/types/timeline.ts`
- Modify: `frontend/src/pages/Editor.tsx`
- Modify: `frontend/src/utils/workflowExecutor.ts`
- Modify: `frontend/src/stores/timelineStore.ts`

**Interfaces:**
- Produces: `Clip.subtitleText?: string`, `Clip.mediaType` 新增 `'subtitle'`
- Produces: `timelineStore.updateClipText(trackId, clipId, text)`

- [ ] **Step 1: 扩展 Clip 接口**

在 `frontend/src/types/timeline.ts` 中修改：

```typescript
// 第5行 Clip 接口
export interface Clip {
  id: string;
  trackId: string;
  start: number;
  end: number;
  mediaUrl: string;
  mediaType?: 'image' | 'video' | 'audio' | 'subtitle';  // 新增 subtitle
  label: string;
  color?: string;
  nodeId?: string;
  subtitleText?: string;  // 新增：字幕文本内容
}
```

- [ ] **Step 2: 修正 Editor.tsx 中 TTS 字幕片段**

在 `frontend/src/pages/Editor.tsx` 的 `handleAddToTimeline` 函数中（约第407行），将 TTS 字幕片段的 `mediaType` 从 `'audio'` 改为 `'subtitle'`，并设置 `subtitleText`：

```typescript
// TTS 产出：同时往字幕轨添加字幕片段
if (artifact.type === 'audio') {
  const subtitleTrack = timelineTracks.find((t) => t.type === 'subtitle');
  if (subtitleTrack) {
    const subtitleText = (data.params?.text as string) || (data.params?.prompt as string) || '';
    const subtitleClip: Clip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trackId: subtitleTrack.id,
      start: clip.start,
      end: clip.end,
      mediaType: 'subtitle',        // 修正：从 'audio' 改为 'subtitle'
      mediaUrl: '',
      label: subtitleText.slice(0, 20) + (subtitleText.length > 20 ? '…' : '') || clip.label,
      subtitleText,                  // 新增：实际字幕文本
      color: undefined,
      nodeId: selectedNode.id,
    };
    addClip(subtitleTrack.id, subtitleClip);
  }
}
```

- [ ] **Step 3: 修正 workflowExecutor.ts 中 TTS 字幕片段**

在 `frontend/src/utils/workflowExecutor.ts` 的自动加入时间轴逻辑中（约第230行），同样修改：

```typescript
// TTS 产出：同时往字幕轨添加字幕片段
if (artifact.type === 'audio') {
  const subtitleTrack = timelineData.tracks.find((t) => t.type === 'subtitle');
  if (subtitleTrack) {
    const subText = (node.data.params?.text as string) || (node.data.params?.prompt as string) || '';
    addClip(subtitleTrack.id, {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trackId: subtitleTrack.id,
      start: timelineData.currentTime,
      end: timelineData.currentTime + duration,
      mediaUrl: '',
      mediaType: 'subtitle',         // 修正：从 'audio' 改为 'subtitle'
      label: subText.slice(0, 20) + (subText.length > 20 ? '…' : '') || node.data.label || node.data.subtype,
      subtitleText: subText,          // 新增
      nodeId,
    });
  }
}
```

- [ ] **Step 4: 新增 timelineStore.updateClipText 方法**

在 `frontend/src/stores/timelineStore.ts` 的 `TimelineState` 接口和实现中新增：

接口新增：
```typescript
updateClipText: (trackId: string, clipId: string, text: string) => void;
```

实现新增：
```typescript
updateClipText: (trackId, clipId, text) =>
  set((state) => ({
    data: {
      ...state.data,
      tracks: state.data.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === clipId
                  ? {
                      ...c,
                      subtitleText: text,
                      label: text.slice(0, 20) + (text.length > 20 ? '…' : '') || c.label,
                    }
                  : c
              ),
            }
          : t
      ),
    },
  })),
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/types/timeline.ts frontend/src/pages/Editor.tsx frontend/src/utils/workflowExecutor.ts frontend/src/stores/timelineStore.ts
git commit -m "扩展Clip模型支持字幕类型并修正TTS字幕片段"
```

---

### Task 2: 预览叠加 — usePreviewContent + VideoPreview 字幕覆盖层

**Files:**
- Modify: `frontend/src/hooks/usePreviewContent.ts`
- Modify: `frontend/src/components/preview/VideoPreview.tsx`
- Modify: `frontend/src/components/EditorLayout.tsx`（传递 subtitleText prop）

**Interfaces:**
- Consumes: `Clip.subtitleText`, `Clip.mediaType: 'subtitle'`（来自 Task 1）
- Produces: `PreviewContent.subtitleText`, VideoPreview 的 `subtitleText` prop

- [ ] **Step 1: 修改 usePreviewContent**

在 `frontend/src/hooks/usePreviewContent.ts` 中：

1. 扩展返回类型：
```typescript
interface PreviewContent {
  url: string | undefined;
  type: 'image' | 'video' | undefined;
  subtitleText?: string;  // 新增
}
```

2. 修改过滤条件（第25行），从 `c.mediaUrl` 改为 `c.mediaUrl || c.subtitleText`：
```typescript
.filter((c) => ct >= c.start && ct < c.end && (c.mediaUrl || c.subtitleText))
```

3. 字幕片段独立提取：
```typescript
// 在活跃片段排序后，分别提取媒体和字幕
const mediaClip = activeClips.find((c) => c.mediaUrl);
const subtitleClip = activeClips.find((c) => c.trackType === 'subtitle' && c.subtitleText);

if (isTimelinePlaying) {
  // ... 原有媒体预览逻辑
  if (mediaClip) {
    const clipType = mediaClip.mediaType || 'video';
    return { url: mediaClip.mediaUrl, type: clipType as 'image' | 'video' | undefined, subtitleText: subtitleClip?.subtitleText };
  }
  // 只有字幕没有媒体
  if (subtitleClip) {
    return { url: undefined, type: undefined, subtitleText: subtitleClip.subtitleText };
  }
  return { url: undefined, type: undefined };
}
```

4. 非播放状态下也需要传递 subtitleText（当用户选中字幕片段时）：
在 `selectedClipMedia` 和 `selectedNodeId` 分支中，如果关联的是字幕片段也返回 subtitleText。

- [ ] **Step 2: 修改 VideoPreview 组件**

在 `frontend/src/components/preview/VideoPreview.tsx` 中：

1. 扩展 props 接口：
```typescript
interface VideoPreviewProps {
  src?: string;
  poster?: string;
  mediaType?: 'image' | 'video';
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  subtitleText?: string;  // 新增
}
```

2. 解构新 prop：
```typescript
export default function VideoPreview({ src, poster, mediaType, currentTime, onTimeUpdate, subtitleText }: VideoPreviewProps) {
```

3. 在返回 JSX 的容器 `div` 末尾（全屏按钮之前）添加字幕覆盖层：
```tsx
{/* 字幕覆盖层 */}
{subtitleText && (
  <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-1.5 rounded text-sm max-w-[80%] text-center transition-opacity duration-200 pointer-events-none">
    {subtitleText}
  </div>
)}
```

- [ ] **Step 3: 传递 subtitleText 到 VideoPreview**

在 `frontend/src/components/EditorLayout.tsx` 中找到 VideoPreview 的使用位置，将 `usePreviewContent` 返回的 `subtitleText` 传递下去。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/hooks/usePreviewContent.ts frontend/src/components/preview/VideoPreview.tsx frontend/src/components/EditorLayout.tsx
git commit -m "预览叠加字幕覆盖层"
```

---

### Task 3: 时间轴字幕编辑 — 内联编辑 + 手动添加

**Files:**
- Modify: `frontend/src/components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: `timelineStore.updateClipText`, `Clip.subtitleText`（来自 Task 1）
- Produces: 字幕片段内联编辑交互、手动添加字幕按钮

- [ ] **Step 1: 添加字幕编辑状态**

在 Timeline 组件中新增状态：
```typescript
const [editingClipId, setEditingClipId] = useState<string | null>(null);
const [editingText, setEditingText] = useState('');
```

- [ ] **Step 2: 字幕片段显示 subtitleText**

修改片段内容渲染（约第409行），字幕轨的片段显示 subtitleText：
```tsx
<span className={`text-xs text-slate-300 truncate pointer-events-none ${track.type === 'subtitle' ? 'text-[10px]' : ''}`}>
  {track.type === 'subtitle' && clip.subtitleText
    ? clip.subtitleText.length > 20
      ? clip.subtitleText.slice(0, 20) + '…'
      : clip.subtitleText
    : clip.label}
</span>
```

- [ ] **Step 3: 双击字幕片段弹出内联编辑框**

修改 `onDoubleClick` 处理，对字幕片段弹出编辑框：
```tsx
onDoubleClick={() => {
  if (clip.nodeId) setSelectedNodeIds([clip.nodeId]);
  if (clip.mediaUrl && onClipClick) onClipClick(clip);
  // 字幕片段：弹出内联编辑
  if (track.type === 'subtitle') {
    setEditingClipId(clip.id);
    setEditingText(clip.subtitleText || '');
  }
}}
```

在片段渲染中，当 `editingClipId === clip.id` 且 `track.type === 'subtitle'` 时，用 `<input>` 替代 `<span>`：
```tsx
{editingClipId === clip.id && track.type === 'subtitle' ? (
  <input
    className="w-full bg-black/40 text-white text-[10px] px-1 py-0.5 rounded outline-none border border-white/30"
    value={editingText}
    onChange={(e) => setEditingText(e.target.value)}
    onBlur={() => {
      updateClipText(track.id, clip.id, editingText);
      setEditingClipId(null);
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        updateClipText(track.id, clip.id, editingText);
        setEditingClipId(null);
      } else if (e.key === 'Escape') {
        setEditingClipId(null);
      }
    }}
    autoFocus
    onClick={(e) => e.stopPropagation()}
    onPointerDown={(e) => e.stopPropagation()}
  />
) : (
  <span className={`text-xs text-slate-300 truncate pointer-events-none ${track.type === 'subtitle' ? 'text-[10px]' : ''}`}>
    {track.type === 'subtitle' && clip.subtitleText
      ? clip.subtitleText.length > 20 ? clip.subtitleText.slice(0, 20) + '…' : clip.subtitleText
      : clip.label}
  </span>
)}
```

需要从 timelineStore 解构 `updateClipText`：
```typescript
const { data, isPlaying, play, pause, seekTo, addTrack, removeTrack, toggleTrackMute, toggleTrackLock, toggleTrackVisibility, removeClip, moveClip, resizeClip, setZoom, updateClipText } = useTimelineStore();
```

- [ ] **Step 4: 字幕轨空区域「+ 添加字幕」按钮**

修改字幕轨空区域提示（约第380行），增加添加按钮：
```tsx
{track.clips.length === 0 && (
  <div className="absolute inset-0 flex items-center justify-center gap-2">
    {track.type === 'subtitle' ? (
      <>
        <span className="text-[10px] text-slate-600">双击编辑字幕</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const { currentTime } = useTimelineStore.getState().data;
            const newClip: Clip = {
              id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              trackId: track.id,
              start: currentTime,
              end: currentTime + 3,
              mediaType: 'subtitle',
              mediaUrl: '',
              label: '新字幕',
              subtitleText: '',
              nodeId: undefined,
            };
            addClip(track.id, newClip);
            setEditingClipId(newClip.id);
            setEditingText('');
          }}
          className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-canvas-hover transition-colors"
        >
          + 添加字幕
        </button>
      </>
    ) : (
      <span className="text-[10px] text-slate-600">执行节点后，在属性面板点击「加入时间轴」</span>
    )}
  </div>
)}
```

需要导入 Clip 类型（已在文件中导入）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/timeline/Timeline.tsx
git commit -m "字幕轨内联编辑和手动添加"
```

---

### Task 4: 后端 AI 字幕生成接口

**Files:**
- Modify: `backend/app/services/ai_service.py`
- Modify: `backend/app/tasks/render_tasks.py`
- Modify: `backend/app/api/ai.py`

**Interfaces:**
- Produces: `POST /api/v1/ai/generate-subtitles` 接口
- Produces: `ai_subtitle` task type
- Produces: `text_to_subtitle` 节点配置映射

- [ ] **Step 1: ai_service.py 新增 text_to_subtitle 映射**

在 `NODE_WHITELIST` 中新增：
```python
"text_to_subtitle": "ai_inference",
```

在 `NODE_DEFAULT_LABELS` 中新增：
```python
"text_to_subtitle": "AI 字幕",
```

在 `NODE_DEFAULT_PARAMS` 中新增：
```python
"text_to_subtitle": {"prompt": "", "duration": 30},
```

在 `AI_INFERENCE_MODEL_TYPE` 中新增：
```python
"text_to_subtitle": "llm",
```

- [ ] **Step 2: render_tasks.py 新增 ai_subtitle task type**

在 `AI_TASK_CONFIG` 字典中新增：
```python
"ai_subtitle": {
    "default_prompt": "生成字幕文本",
    "needs_image": False,
    "result_key": "segments",
    "fallback_msg": "未配置LLM模型",
    "has_size_param": False,
    "has_size_retry": False,
},
```

在 `_execute_ai_task` 的路由规则中，`ai_subtitle` 走 `_do_llm` 路径（已在 else 分支覆盖，无需额外修改）。

- [ ] **Step 3: api/ai.py 新增 generate-subtitles 接口**

在 `backend/app/api/ai.py` 末尾新增：

```python
# ── AI 字幕生成 ──

class GenerateSubtitlesRequest(BaseModel):
    prompt: str
    duration: float = 30
    model_id: str | None = None


SUBTITLE_SYSTEM_PROMPT = """你是一个专业的字幕生成助手。根据用户提供的文本内容，生成带时间轴的字幕分段。

输出严格的 JSON 格式（不要 markdown 代码块，不要额外文字）：
{"segments":[{"start":0.0,"end":3.5,"text":"第一句字幕"},{"start":3.5,"end":7.0,"text":"第二句字幕"}]}

规则：
1. start/end 为秒数，从 0 开始
2. 每段字幕 2-5 秒，根据语义自然断句
3. 所有段时间总和应接近总时长 duration
4. 段与段时间连续，不重叠不间隔
5. text 使用中文
"""


@router.post("/generate-subtitles", summary="AI 生成字幕")
async def generate_subtitles(body: GenerateSubtitlesRequest, db: DBSession, user: CurrentUser):
    """根据文本内容生成带时间轴的字幕分段"""
    from app.services.ai_service import call_llm, _get_default_llm_model_id
    import json

    model_id = await _get_default_llm_model_id(db, body.model_id)
    messages = [
        {"role": "system", "content": SUBTITLE_SYSTEM_PROMPT},
        {"role": "user", "content": f"文本内容：{body.prompt}\n总时长（秒）：{body.duration}"},
    ]
    logger.info(f"[AI:Subtitle] 生成字幕, duration={body.duration}, prompt={body.prompt[:50]}")

    raw = await call_llm(db, model_id, messages, temperature=0.3)

    # 解析 JSON（容忍 markdown 代码块包裹）
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"AI 返回格式异常: {e}")

    segments = data.get("segments", [])
    if not segments:
        raise HTTPException(status_code=422, detail="AI 未生成字幕分段")

    return {"segments": segments}
```

- [ ] **Step 4: 提交**

```bash
git add backend/app/services/ai_service.py backend/app/tasks/render_tasks.py backend/app/api/ai.py
git commit -m "后端AI字幕生成接口"
```

---

### Task 5: 前端 AI 字幕节点 + 调用逻辑

**Files:**
- Modify: `frontend/src/types/canvas.ts`
- Modify: `frontend/src/utils/workflowExecutor.ts`
- Modify: `frontend/src/utils/apiClient.ts`
- Modify: `frontend/src/pages/Editor.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/ai/generate-subtitles`（来自 Task 4）
- Produces: `text_to_subtitle` 画布节点、AI 字幕执行逻辑

- [ ] **Step 1: canvas.ts 新增 text_to_subtitle 节点模板**

在 `AIInferenceSubtype` 类型中新增：
```typescript
export type AIInferenceSubtype = 'text_to_image' | 'image_to_image' | 'image_to_video' | 'text_to_video' | 'text_to_speech' | 'text_to_subtitle';
```

在 `NODE_TEMPLATES` 数组的 AI 推理节点区域新增：
```typescript
{ type: 'ai_inference', subtype: 'text_to_subtitle', label: 'AI 字幕', icon: 'Subtitles', category: 'AI 推理', defaultParams: { prompt: '', duration: 30 } },
```

- [ ] **Step 2: workflowExecutor.ts 新增路由**

1. 在 `AI_SUBTYPES` 数组中新增 `'text_to_subtitle'`
2. 在 task type 映射中新增：
```typescript
if (subtype === 'text_to_subtitle') return 'ai_subtitle';
```
3. 在 model_type 映射中新增：
```typescript
text_to_subtitle: 'llm',
```
4. 在产出类型判断中（约第187行），`ai_subtitle` 的产出类型应为 `'subtitle'`（不是 video/audio/image），需要在 `artifacts` 构建中特殊处理

- [ ] **Step 3: apiClient.ts 新增字幕生成 API**

在 `aiApi` 对象中新增：
```typescript
async generateSubtitles(prompt: string, duration: number = 30, modelId?: string) {
  return request<{ segments: Array<{ start: number; end: number; text: string }> }>(
    '/ai/generate-subtitles',
    { method: 'POST', body: { prompt, duration, model_id: modelId } }
  );
},
```

- [ ] **Step 4: Editor.tsx 处理 text_to_subtitle 节点执行**

当 `text_to_subtitle` 节点执行完成后，需要将返回的 `segments` 批量添加到字幕轨。在 `workflowExecutor.ts` 的 `executeNode` 中，`ai_subtitle` 任务的 result 应包含 `segments` 数据，前端据此批量创建字幕片段。

在 `workflowExecutor.ts` 的产出构建逻辑中，`ai_subtitle` 任务不走常规的 artifact 路径，而是直接从 result 中提取 segments 并批量添加字幕片段到字幕轨。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/types/canvas.ts frontend/src/utils/workflowExecutor.ts frontend/src/utils/apiClient.ts frontend/src/pages/Editor.tsx
git commit -m "前端AI字幕节点和调用逻辑"
```

---

### Task 6: 导出烧录字幕

**Files:**
- Modify: `frontend/src/components/ExportModal.tsx`
- Modify: `frontend/src/utils/apiClient.ts`
- Modify: `backend/app/services/export_service.py`
- Modify: `backend/app/api/render.py`

**Interfaces:**
- Consumes: 字幕轨片段数据（来自 Task 1-3）
- Produces: 导出视频包含烧录字幕

- [ ] **Step 1: ExportModal 新增烧录字幕开关**

1. 从 `useTimelineStore` 获取字幕轨片段
2. 新增 `burnSubtitles` state（默认 true）
3. 字幕轨有片段时显示开关
4. 提交时收集字幕数据

```typescript
const timelineData = useTimelineStore((s) => s.data);
const subtitleClips = timelineData.tracks
  .filter((t) => t.type === 'subtitle')
  .flatMap((t) => t.clips)
  .filter((c) => c.subtitleText);

// state
const [burnSubtitles, setBurnSubtitles] = useState(true);

// UI（分辨率选择下方）
{subtitleClips.length > 0 && (
  <div className="space-y-1.5">
    <label className="text-xs text-slate-500 uppercase tracking-wider">字幕</label>
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-300">烧录字幕到视频</span>
      <Toggle checked={burnSubtitles} onChange={setBurnSubtitles} />
    </div>
  </div>
)}

// 提交时
const subtitles = burnSubtitles
  ? subtitleClips.map((c) => ({ start: c.start, end: c.end, text: c.subtitleText || '' }))
  : [];
renderApi.exportVideo(projectId, format, resolution, subtitles);
```

- [ ] **Step 2: apiClient.ts 修改导出接口**

修改 `exportVideo` 方法签名，新增 `subtitles` 参数：
```typescript
async exportVideo(projectId: string, format: string, resolution: string, subtitles: Array<{ start: number; end: number; text: string }> = []) {
  return request<{ task_id: string }>(
    `/render/export`,
    { method: 'POST', body: { project_id: projectId, format, resolution, subtitles } }
  );
},
```

- [ ] **Step 3: 后端 render.py 接收字幕参数**

修改导出请求 schema，新增 `subtitles` 字段：
```python
class ExportRequest(BaseModel):
    project_id: str
    format: str = "mp4"
    resolution: str = "1080p"
    subtitles: list[dict] = []  # [{start, end, text}]
```

将 `subtitles` 传递给 `compose_video`。

- [ ] **Step 4: 后端 export_service.py 实现字幕烧录**

修改 `compose_video` 函数签名，新增 `subtitles` 参数：

```python
async def compose_video(
    clips: list[dict],
    output_format: str,
    resolution: str,
    duration: float,
    task_id: str,
    subtitles: list[dict] | None = None,  # 新增
) -> Path:
```

在 FFmpeg 命令构建前，生成临时 SRT 文件并添加字幕滤镜：

```python
# 字幕烧录
subtitle_vf = ""
if subtitles:
    srt_path = os.path.join(tmp_dir, "subtitles.srt")
    with open(srt_path, 'w', encoding='utf-8') as f:
        for i, sub in enumerate(subtitles, 1):
            start_h, start_rem = divmod(sub['start'], 3600)
            start_m, start_s = divmod(start_rem, 60)
            start_ms = int((sub['start'] % 1) * 1000)
            end_h, end_rem = divmod(sub['end'], 3600)
            end_m, end_s = divmod(end_rem, 60)
            end_ms = int((sub['end'] % 1) * 1000)
            f.write(f"{i}\n")
            f.write(f"{int(start_h):02d}:{int(start_m):02d}:{int(start_s):02d},{start_ms:03d} --> ")
            f.write(f"{int(end_h):02d}:{int(end_m):02d}:{int(end_s):02d},{end_ms:03d}\n")
            f.write(f"{sub['text']}\n\n")
    subtitle_vf = f"subtitles={srt_path}:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2'"
```

在 FFmpeg 命令的 `-vf` 参数中合并字幕滤镜：
```python
# 示例：单个视频片段 + 字幕
if subtitle_vf:
    cmd = [
        'ffmpeg', '-y',
        '-i', str(video_clips[0][1]),
        '-vf', f"scale={scale},{subtitle_vf}",
        '-c:v', 'libx264', '-c:a', 'aac',
        '-t', str(duration),
        str(output_path)
    ]
```

对无视频片段和多片段 concat 的场景也做同样处理。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ExportModal.tsx frontend/src/utils/apiClient.ts backend/app/services/export_service.py backend/app/api/render.py
git commit -m "导出烧录字幕功能"
```
