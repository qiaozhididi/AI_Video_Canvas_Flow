// 画布节点类型
export type NodeType = 'input' | 'ai_inference' | 'processing' | 'control' | 'output';

// 节点执行状态
export type NodeStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

// 输入节点子类型
export type InputSubtype = 'text_input' | 'image_input' | 'audio_input';

// AI 推理节点子类型
export type AIInferenceSubtype = 'text_to_image' | 'image_to_video' | 'text_to_speech';

// 处理节点子类型
export type ProcessingSubtype = 'upscale' | 'style_transfer' | 'remove_bg' | 'extend_image';

// 控制节点子类型
export type ControlSubtype = 'if_else' | 'loop' | 'merge';

// 输出节点子类型
export type OutputSubtype = 'video_output' | 'image_output' | 'audio_output';

// 所有节点子类型
export type NodeSubtype =
  | InputSubtype
  | AIInferenceSubtype
  | ProcessingSubtype
  | ControlSubtype
  | OutputSubtype;

// 媒体资产
export interface Artifact {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  filename: string;
  size: number;
  metadata?: Record<string, unknown>;
}

// 画布节点数据（React Flow 节点 data 字段）
export interface CanvasNodeData {
  type: NodeType;
  subtype: NodeSubtype;
  label: string;
  params: Record<string, unknown>;
  status: NodeStatus;
  progress: number;
  outputArtifacts: Artifact[];
  error?: string;
}

// React Flow 节点类型
export type CanvasNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: CanvasNodeData;
  measured?: { width?: number; height?: number };
};

// React Flow 边类型
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// 节点模板（用于节点面板拖拽创建）
export interface NodeTemplate {
  type: NodeType;
  subtype: NodeSubtype;
  label: string;
  icon: string;
  category: string;
  defaultParams: Record<string, unknown>;
}

// 节点分类
export const NODE_CATEGORIES: Record<NodeType, { label: string; color: string }> = {
  input: { label: '输入', color: '#3B82F6' },
  ai_inference: { label: 'AI 推理', color: '#7C3AED' },
  processing: { label: '处理', color: '#06B6D4' },
  control: { label: '控制', color: '#EAB308' },
  output: { label: '输出', color: '#22C55E' },
};

// 所有可用节点模板
export const NODE_TEMPLATES: NodeTemplate[] = [
  // 输入节点
  { type: 'input', subtype: 'text_input', label: '文本输入', icon: 'Type', category: '输入', defaultParams: { text: '' } },
  { type: 'input', subtype: 'image_input', label: '图片输入', icon: 'Image', category: '输入', defaultParams: { url: '' } },
  { type: 'input', subtype: 'audio_input', label: '音频输入', icon: 'Music', category: '输入', defaultParams: { url: '' } },
  // AI 推理节点
  { type: 'ai_inference', subtype: 'text_to_image', label: '文生图', icon: 'Wand2', category: 'AI 推理', defaultParams: { model: 'sd3', width: 1024, height: 1024, steps: 30 } },
  { type: 'ai_inference', subtype: 'image_to_video', label: '图生视频', icon: 'Video', category: 'AI 推理', defaultParams: { model: 'kling', duration: 5, fps: 24 } },
  { type: 'ai_inference', subtype: 'text_to_speech', label: '文生语音', icon: 'Mic', category: 'AI 推理', defaultParams: { model: 'cosyvoice', voice: 'default', speed: 1.0 } },
  // 处理节点
  { type: 'processing', subtype: 'upscale', label: '高清放大', icon: 'Maximize', category: '处理', defaultParams: { scale: 2 } },
  { type: 'processing', subtype: 'style_transfer', label: '风格化', icon: 'Palette', category: '处理', defaultParams: { style: 'anime' } },
  { type: 'processing', subtype: 'remove_bg', label: '抠图', icon: 'Scissors', category: '处理', defaultParams: {} },
  { type: 'processing', subtype: 'extend_image', label: '扩图', icon: 'Expand', category: '处理', defaultParams: { direction: 'all' } },
  // 控制节点
  { type: 'control', subtype: 'if_else', label: '条件分支', icon: 'GitBranch', category: '控制', defaultParams: { condition: '' } },
  { type: 'control', subtype: 'loop', label: '循环', icon: 'Repeat', category: '控制', defaultParams: { count: 3 } },
  { type: 'control', subtype: 'merge', label: '合并', icon: 'GitMerge', category: '控制', defaultParams: {} },
  // 输出节点
  { type: 'output', subtype: 'video_output', label: '视频输出', icon: 'Film', category: '输出', defaultParams: { format: 'mp4' } },
  { type: 'output', subtype: 'image_output', label: '图片输出', icon: 'ImageDown', category: '输出', defaultParams: { format: 'png' } },
  { type: 'output', subtype: 'audio_output', label: '音频输出', icon: 'Volume2', category: '输出', defaultParams: { format: 'mp3' } },
];
