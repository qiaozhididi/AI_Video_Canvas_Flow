import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';

/**
 * Mock 数据：模拟一个"文生图 → 图生视频 → 语音合成 → 合成输出"的完整工作流
 * 用于本地验证撤销/重做系统
 */

// 节点
export const MOCK_NODES: CanvasNode[] = [
  {
    id: 'node-text-input-1',
    type: 'input',
    position: { x: 50, y: 100 },
    data: {
      type: 'input',
      subtype: 'text_input',
      label: '文本输入',
      params: { text: '一座被霓虹灯照亮的赛博朋克城市，雨夜，远景' },
      status: 'completed',
      progress: 100,
      outputArtifacts: [
        { id: 'art-1', type: 'image', url: '/mock/city.png', filename: 'city.png', size: 2048000 },
      ],
    },
  },
  {
    id: 'node-image-input-1',
    type: 'input',
    position: { x: 50, y: 320 },
    data: {
      type: 'input',
      subtype: 'image_input',
      label: '图片输入',
      params: { url: '/mock/character.png' },
      status: 'completed',
      progress: 100,
      outputArtifacts: [
        { id: 'art-2', type: 'image', url: '/mock/character.png', filename: 'character.png', size: 1536000 },
      ],
    },
  },
  {
    id: 'node-t2i-1',
    type: 'ai_inference',
    position: { x: 350, y: 100 },
    data: {
      type: 'ai_inference',
      subtype: 'text_to_image',
      label: '文生图',
      params: { model: 'sd3', width: 1024, height: 1024, steps: 30 },
      status: 'completed',
      progress: 100,
      outputArtifacts: [
        { id: 'art-3', type: 'image', url: '/mock/generated_city.png', filename: 'generated_city.png', size: 3072000 },
      ],
    },
  },
  {
    id: 'node-i2v-1',
    type: 'ai_inference',
    position: { x: 650, y: 100 },
    data: {
      type: 'ai_inference',
      subtype: 'image_to_video',
      label: '图生视频',
      params: { model: 'kling', duration: 5, fps: 24 },
      status: 'running',
      progress: 67,
      outputArtifacts: [],
    },
  },
  {
    id: 'node-tts-1',
    type: 'ai_inference',
    position: { x: 350, y: 320 },
    data: {
      type: 'ai_inference',
      subtype: 'text_to_speech',
      label: '文生语音',
      params: { model: 'cosyvoice', voice: 'default', speed: 1.0 },
      status: 'idle',
      progress: 0,
      outputArtifacts: [],
    },
  },
  {
    id: 'node-upscale-1',
    type: 'processing',
    position: { x: 650, y: 320 },
    data: {
      type: 'processing',
      subtype: 'upscale',
      label: '高清放大',
      params: { scale: 2 },
      status: 'pending',
      progress: 0,
      outputArtifacts: [],
    },
  },
  {
    id: 'node-if-else-1',
    type: 'control',
    position: { x: 950, y: 200 },
    data: {
      type: 'control',
      subtype: 'if_else',
      label: '条件分支',
      params: { condition: 'video.duration > 3' },
      status: 'idle',
      progress: 0,
      outputArtifacts: [],
    },
  },
  {
    id: 'node-video-out-1',
    type: 'output',
    position: { x: 1250, y: 150 },
    data: {
      type: 'output',
      subtype: 'video_output',
      label: '视频输出',
      params: { format: 'mp4' },
      status: 'idle',
      progress: 0,
      outputArtifacts: [],
    },
  },
  {
    id: 'node-audio-out-1',
    type: 'output',
    position: { x: 1250, y: 350 },
    data: {
      type: 'output',
      subtype: 'audio_output',
      label: '音频输出',
      params: { format: 'mp3' },
      status: 'idle',
      progress: 0,
      outputArtifacts: [],
    },
  },
];

// 边
export const MOCK_EDGES: CanvasEdge[] = [
  { id: 'edge-1', source: 'node-text-input-1', target: 'node-t2i-1' },
  { id: 'edge-2', source: 'node-t2i-1', target: 'node-i2v-1' },
  { id: 'edge-3', source: 'node-image-input-1', target: 'node-tts-1' },
  { id: 'edge-4', source: 'node-i2v-1', target: 'node-if-else-1' },
  { id: 'edge-5', source: 'node-tts-1', target: 'node-upscale-1' },
  { id: 'edge-6', source: 'node-if-else-1', target: 'node-video-out-1' },
  { id: 'edge-7', source: 'node-upscale-1', target: 'node-audio-out-1' },
];

/**
 * 加载 Mock 数据到 canvasStore，同时记录到 historyStore
 * 在编辑器页面初始化时调用
 */
export function loadMockData() {
  const canvasStore = useCanvasStore.getState();
  const historyStore = useHistoryStore.getState();

  // 暂停录制，避免批量加载被记录为多个操作
  historyStore.pauseRecording();

  canvasStore.setNodes(MOCK_NODES);
  canvasStore.setEdges(MOCK_EDGES);

  historyStore.resumeRecording();

  console.log('[MockData] 已加载 Mock 数据:', {
    nodes: MOCK_NODES.length,
    edges: MOCK_EDGES.length,
  });
}
