# 字幕轨功能完善设计

> 日期: 2026-07-09
> 状态: Draft

## 背景

当前字幕轨仅有数据结构壳子，缺乏真正的字幕功能：
1. `Clip.mediaType` 无 `'subtitle'` 值，TTS 字幕片段用 `'audio'` 代替
2. `Clip.mediaUrl` 为空字符串，`usePreviewContent` 会将其过滤掉，字幕不会出现在预览中
3. VideoPreview 没有字幕叠加渲染
4. 时间轴上无法编辑字幕文本
5. 导出时不会烧录字幕

## 需求

### 字幕来源
1. **TTS 自动生成** — TTS 节点执行后，输入文本自动同步到字幕轨
2. **手动编辑** — 用户可在字幕轨上直接创建/编辑字幕片段
3. **AI 生成** — 通过 AI 字幕节点（调用 LLM）根据视频/音频内容生成字幕

### 预览
- VideoPreview 播放时，在视频画面底部叠加 HTML 字幕覆盖层
- 样式类似 YouTube CC：白字、半透明黑色背景条、底部居中

### 导出
- FFmpeg 将字幕烧录到视频画面，输出单文件 MP4
- 导出弹窗提供「烧录字幕」开关（默认开启）

## 设计决策

### 方案选择：扩展现有 Clip 模型（方案 A）

在现有 `Clip` 接口上新增 `subtitleText` 可选字段，字幕片段复用同一套数据结构和交互逻辑。

**理由**：字幕片段与媒体片段在时间轴上的交互行为完全一致（拖拽、resize、吸附、锁定、静音），唯一区别是内容类型。一个可选字段比双类型系统简单得多，对现有代码侵入最小。

## 详细设计

### 1. 数据模型

#### Clip 接口扩展（`frontend/src/types/timeline.ts`）

```typescript
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
  subtitleText?: string;  // 新增：字幕文本内容（仅字幕片段使用）
}
```

**字段语义**：
- `mediaType: 'subtitle'` — 标识字幕片段
- `subtitleText` — 字幕实际文本，用于预览叠加和导出烧录
- `label` — 片段在时间轴上的显示名称（截断的文本或节点名）
- `mediaUrl` — 字幕片段为空字符串

#### TTS 字幕片段修正

当前 TTS 字幕片段的 `mediaType` 为 `'audio'`，需改为 `'subtitle'`：
- `Editor.tsx` 的 `handleAddToTimeline`：`mediaType: 'audio'` → `mediaType: 'subtitle'`
- `workflowExecutor.ts` 自动添加逻辑：同上
- `subtitleText` 取自 `data.params?.text || data.params?.prompt`

### 2. 预览叠加

#### usePreviewContent 修改（`frontend/src/hooks/usePreviewContent.ts`）

**当前问题**：第25行 `filter((c) => ct >= c.start && ct < c.end && c.mediaUrl)` 会排除 `mediaUrl` 为空的字幕片段。

**修改方案**：
- 过滤条件改为 `c.mediaUrl || c.subtitleText`，字幕片段通过 `subtitleText` 有值来判断活跃
- 返回类型新增 `subtitleText?: string`
- 播放时，video/audio 片段控制预览内容（url/type），字幕片段独立提供叠加文本

```typescript
interface PreviewContent {
  url: string | undefined;
  type: 'image' | 'video' | undefined;
  subtitleText?: string;  // 新增
}
```

查找逻辑：
1. 收集所有活跃片段（含字幕片段）
2. 媒体片段排序后取第一个作为预览内容
3. 字幕片段单独提取，返回 `subtitleText`

#### VideoPreview 字幕覆盖层（`frontend/src/components/preview/VideoPreview.tsx`）

在视频播放器外层容器中添加绝对定位的 `<div>`：

```
┌─────────────────────────────┐
│                             │
│        视频画面             │
│                             │
│  ┌───────────────────────┐  │
│  │   字幕文本内容        │  │  ← 底部 8%，半透明黑底白字
│  └───────────────────────┘  │
└─────────────────────────────┘
```

- 位置：`absolute bottom-[8%] left-1/2 -translate-x-1/2`
- 样式：`bg-black/70 text-white px-4 py-1.5 rounded text-sm max-w-[80%] text-center`
- 显示条件：`subtitleText` 非空
- 过渡：`opacity transition 200ms`

### 3. 字幕编辑

#### timelineStore 新增方法（`frontend/src/stores/timelineStore.ts`）

```typescript
updateClipText: (trackId: string, clipId: string, text: string) => void;
```

实现：找到对应 clip，更新 `subtitleText`，同时更新 `label` 为截断文本。

#### 时间轴片段显示（`frontend/src/components/timeline/Timeline.tsx`）

字幕片段在时间轴上：
- 显示 `subtitleText` 前 20 字符（超出截断 + `…`）
- 无 `subtitleText` 时显示 `label`
- 视觉区分：字幕片段文字更小（`text-[10px]`），颜色用 `#EAB308`（已有）

#### 双击编辑字幕

- 双击字幕片段 → 片段内显示 `<input>` 替代 `<span>`
- Enter 或失焦 → 调用 `updateClipText` 保存
- Esc → 恢复原值
- 仅字幕片段（`track.type === 'subtitle'`）支持内联编辑

#### 手动添加字幕

字幕轨空区域提示文字旁增加「+ 添加字幕」按钮：
- 点击后在当前播放头位置创建 3 秒字幕片段
- `subtitleText` 为空字符串
- 自动弹出内联编辑框

### 4. AI 字幕生成

#### 新增画布节点：text_to_subtitle

- 类型：`ai_inference`，subtype: `text_to_subtitle`
- 输入：文本 prompt（剧本/摘要/描述内容）+ 可选 duration 参数
- 处理：调用 LLM 生成 SRT 格式字幕文本（LLM 根据文本内容和 duration 自动切分时间轴）
- 输出：解析 SRT，批量添加字幕片段到字幕轨
- 默认参数：`{ prompt: '', duration: 30 }`
- Task type 映射：`text_to_subtitle` → `ai_subtitle`（后端 render_tasks 新增）

**注意**：当前 LLM 无法直接处理音频/视频输入，因此 AI 字幕节点基于文本内容生成字幕，而非"听音频生成字幕"。用户输入剧本/旁白文本，LLM 根据 duration 参数和文本长度自动分配时间戳。

**节点定义位置**：
- 前端 `canvas.ts` NODE_TEMPLATES 新增条目
- 后端 `ai_service.py` NODE_WHITELIST/NODE_DEFAULT_PARAMS 新增映射
- 后端 `ai_service.py` AI_INFERENCE_MODEL_TYPE 映射为 `llm`
- 后端 `render_tasks.py` TASK_TYPE_MAP 新增 `ai_subtitle` → 走 LLM 调用链路

**执行逻辑**：
1. 前端将文本 prompt 和 duration 发送后端
2. 后端调用 LLM（system prompt 指定输出 SRT 格式，要求根据 duration 和文本长度分配时间戳）
3. 后端解析 SRT 文本，返回 `[{ start, end, text }]` 数组
4. 前端接收后批量创建字幕片段到字幕轨

**后端新增接口**：`POST /api/v1/ai/generate-subtitles`
- 请求：`{ prompt: string, duration: number, model_id?: string }`
- 响应：`{ segments: [{ start: float, end: float, text: string }] }`
- 内部调用 `call_llm`，使用专用 system prompt 要求 SRT 格式输出

### 5. 导出烧录

#### 前端传参（ExportModal + apiClient）

导出请求新增 `timeline_data` 字段，包含字幕轨片段信息：
```typescript
{
  format: 'mp4',
  resolution: '1080p',
  burn_subtitles: true,  // 新增
  subtitles: [            // 新增
    { start: 0.0, end: 3.5, text: '字幕内容' },
    ...
  ]
}
```

#### 后端导出逻辑（export_service.py）

1. 若 `burn_subtitles=true` 且有字幕数据：
   - 将字幕片段转为临时 SRT 文件
   - FFmpeg 命令添加 `-vf "subtitles=temp.srt:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2'"`
2. 无字幕时，FFmpeg 命令不变

#### ExportModal UI

- 新增「烧录字幕」开关（Switch 组件），默认开启
- 仅当字幕轨有片段时显示该选项
- 位于分辨率选择下方

## 影响范围

### 前端
| 文件 | 变更 |
|------|------|
| `types/timeline.ts` | Clip 接口新增 subtitleText, mediaType 扩展 |
| `stores/timelineStore.ts` | 新增 updateClipText 方法 |
| `hooks/usePreviewContent.ts` | 修复过滤逻辑, 返回 subtitleText |
| `components/timeline/Timeline.tsx` | 字幕片段显示+内联编辑+手动添加 |
| `components/preview/VideoPreview.tsx` | 字幕覆盖层 |
| `pages/Editor.tsx` | TTS 字幕片段修正 mediaType/subtitleText |
| `utils/workflowExecutor.ts` | TTS 字幕片段修正 |
| `types/canvas.ts` | NODE_TEMPLATES 新增 text_to_subtitle |
| `components/ExportModal.tsx` | 烧录字幕开关 |

### 后端
| 文件 | 变更 |
|------|------|
| `services/ai_service.py` | NODE_WHITELIST/NODE_DEFAULT_PARAMS/AI_INFERENCE_MODEL_TYPE 新增 text_to_subtitle |
| `services/export_service.py` | 字幕 SRT 生成 + FFmpeg 烧录 |
| `api/render.py` | 导出接口接收字幕参数 |
| `api/ai.py` | 新增 generate-subtitles 接口 |
| `tasks/render_tasks.py` | TASK_TYPE_MAP 新增 ai_subtitle |

## 不做

- 字幕样式自定义（字体、颜色、位置）— YAGNI，后续按需添加
- 多语言字幕轨道 — 当前只需一条字幕轨
- SRT/VTT 文件导入导出 — 后续迭代
- 字幕时间轴微调（逐帧调整）— 当前精度（0.1s）够用
