/**
 * 工作流编排引擎
 *
 * 支持：
 * - 单节点执行：读取节点参数 + 上游输出 → 调 render API → 轮询状态 → 更新画布
 * - 全工作流编排：拓扑排序 → 按层并行执行 → 任一失败停止
 */

import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTimelineStore } from '@/stores/timelineStore';
import type { NodeStatus } from '@/types/canvas';
import type { TrackType } from '@/types/timeline';
import { renderApi, aiApi } from '@/utils/apiClient';
import type { CanvasNode, CanvasEdge, NodeSubtype, Artifact } from '@/types/canvas';
import { getErrorMessage } from '@/utils/errorMessages';
import type { RenderTaskResponse } from '@/utils/apiClient';

// ── 节点可执行性判定 ──

const EXECUTABLE_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_image', 'image_to_video', 'text_to_video', 'text_to_speech', 'text_to_subtitle',
  'upscale', 'style_transfer', 'remove_bg', 'extend_image',
  'video_output', 'image_output', 'audio_output',
]);

const AI_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_image', 'image_to_video', 'text_to_video', 'text_to_speech', 'text_to_subtitle',
]);

/** 节点 subtype → 后端 task_type 映射 */
function getTaskType(subtype: NodeSubtype): string {
  if (subtype === 'text_to_image') return 'ai_text2img';
  if (subtype === 'image_to_image') return 'ai_img2img';
  if (subtype === 'image_to_video') return 'ai_img2video';
  if (subtype === 'text_to_video') return 'ai_text2video';
  if (subtype === 'text_to_speech') return 'ai_tts';
  if (subtype === 'text_to_subtitle') return 'ai_subtitle';
  return 'render';
}

/** 是否可执行 */
export function isExecutable(subtype: NodeSubtype): boolean {
  return EXECUTABLE_SUBTYPES.has(subtype);
}

/** 是否需要 AI 模型 */
function needsAiModel(subtype: NodeSubtype): boolean {
  return AI_SUBTYPES.has(subtype);
}

// ── 收集上游输出 ──

function collectUpstreamArtifacts(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    // 先添加节点已有的 outputArtifacts
    if (sourceNode.data.outputArtifacts.length > 0) {
      artifacts.push(...sourceNode.data.outputArtifacts);
      continue;
    }

    // 输入节点没有 outputArtifacts 时，从 params 构建虚拟 artifact
    if (sourceNode.data.type === 'input') {
      if (sourceNode.data.subtype === 'text_input') {
        const text = (sourceNode.data.params.text as string) || '';
        if (text) {
          artifacts.push({
            id: `virtual-${sourceNode.id}`,
            type: 'text',
            url: '',
            filename: 'text_input',
            size: 0,
            metadata: { text, content: text },
          });
        }
      } else if (sourceNode.data.subtype === 'image_input') {
        const url = (sourceNode.data.params.url as string) || '';
        if (url) {
          artifacts.push({
            id: `virtual-${sourceNode.id}`,
            type: 'image',
            url,
            filename: 'image_input',
            size: 0,
          });
        }
      }
    }
  }
  return artifacts;
}

// ── 单节点执行 ──

export async function executeNode(nodeId: string): Promise<RenderTaskResponse> {
  const { nodes, edges } = useCanvasStore.getState();
  const node = nodes.find((n) => n.id === nodeId);

  if (!node) throw new Error('节点不存在');
  if (!isExecutable(node.data.subtype)) throw new Error('该节点无需执行');

  const projectId = useProjectStore.getState().currentProject?.id;
  if (!projectId) throw new Error('未选择项目');

  const taskType = getTaskType(node.data.subtype);

  // 先收集上游输出
  const upstreamArtifacts = collectUpstreamArtifacts(nodeId, nodes, edges);

  let modelId: string | undefined;
  let prompt: string | undefined;

  if (needsAiModel(node.data.subtype)) {
    modelId = node.data.params.model_id as string | undefined;
    if (!modelId) {
      try {
        // 根据节点类型推断 model_type，获取对应类型的默认模型
        const modelTypeMap: Record<string, string> = {
          text_to_image: 'image_gen',
          image_to_image: 'image_gen',
          image_to_video: 'video_gen',
          text_to_video: 'video_gen',
          text_to_speech: 'tts',
          text_to_subtitle: 'llm',
        };
        const modelType = modelTypeMap[node.data.subtype];
        const defaultModel = await aiApi.models.getDefault(modelType);
        modelId = defaultModel.id;
      } catch {
        throw new Error('请先在设置页配置 AI 模型');
      }
    }
    // 提取提示词：优先当前节点的 params.prompt/text，否则从上游节点输出提取
    prompt = (node.data.params.prompt as string) || (node.data.params.text as string) || undefined;

    // 如果当前节点没有 prompt，从上游文本输入节点的 outputArtifacts 提取文本
    if (!prompt && upstreamArtifacts.length > 0) {
      const textParts: string[] = [];
      for (const a of upstreamArtifacts) {
        // 从 artifact 的 metadata 或 url 中提取文本
        const text = (a.metadata?.text as string) || (a.metadata?.content as string);
        if (text) textParts.push(text);
      }
      if (textParts.length > 0) {
        prompt = textParts.join(' ');
      }
    }
  }

  const inputPayload = upstreamArtifacts.length > 0
    ? upstreamArtifacts.map((a) => ({ type: a.type, url: a.url, filename: a.filename, text: (a.metadata?.text as string) || (a.metadata?.content as string) || undefined }))
    : undefined;

  useCanvasStore.getState().setNodeStatus(nodeId, 'pending', 0);

  // ── ai_subtitle 特殊处理：直接调用字幕生成 API，不走 render 流程 ──
  if (taskType === 'ai_subtitle') {
    useCanvasStore.getState().setNodeStatus(nodeId, 'running', 0);
    try {
      const duration = (node.data.params.duration as number) || 30;
      const subtitleResult = await aiApi.generateSubtitles(prompt || '', duration, modelId);
      const segments = subtitleResult.segments || [];

      // 批量将 segments 添加到字幕轨
      if (segments.length > 0) {
        const { addClip, data: timelineData } = useTimelineStore.getState();
        const subtitleTrack = timelineData.tracks.find((t) => t.type === 'subtitle');
        if (subtitleTrack) {
          for (const seg of segments) {
            addClip(subtitleTrack.id, {
              id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              trackId: subtitleTrack.id,
              start: seg.start,
              end: seg.end,
              mediaUrl: '',
              mediaType: 'subtitle',
              subtitleText: seg.text,
              label: seg.text.length > 20 ? seg.text.slice(0, 20) + '…' : seg.text,
              nodeId,
            });
          }
        }
      }

      useCanvasStore.getState().setNodeOutput(nodeId, []);
      useCanvasStore.getState().setNodeStatus(nodeId, 'completed', 100);

      // 返回一个虚拟的 RenderTaskResponse 以保持接口兼容
      return {
        id: `subtitle-${Date.now()}`,
        project_id: projectId,
        owner_id: '',
        task_type: taskType,
        status: 'completed',
        progress: 100,
        celery_task_id: null,
        result_url: null,
        error_message: null,
        node_id: nodeId,
        node_label: node.data.label,
        project_name: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } catch (err: any) {
      useCanvasStore.getState().setNodeError(nodeId, getErrorMessage(err, 'node_execute'));
      throw err;
    }
  }

  const task = await renderApi.create({
    project_id: projectId,
    task_type: taskType,
    node_id: nodeId,
    model_id: modelId,
    prompt,
    input_artifacts: inputPayload,
    node_params: { ...node.data.params },
  });

  useCanvasStore.getState().setNodeStatus(nodeId, 'running', 0);

  try {
    const result = await renderApi.poll(task.id, 2000, (progress, status) => {
      // 只接受合法的 NodeStatus 值，其他一律视为 running
      const validStatus: NodeStatus = ['idle', 'pending', 'running', 'completed', 'failed'].includes(status)
        ? (status as NodeStatus)
        : 'running';
      useCanvasStore.getState().setNodeStatus(nodeId, validStatus, Math.round(progress));
    });

    const artifacts: Artifact[] = result.result_url
      ? [{
          id: `artifact-${Date.now()}`,
          type: (node.data.subtype === 'image_output' || node.data.subtype === 'upscale') ? 'image'
            : taskType.startsWith('ai_text2img') || taskType.startsWith('ai_img2img') ? 'image'
            : taskType.startsWith('ai_img2video') ? 'video'
            : taskType.startsWith('ai_text2video') ? 'video'
            : taskType.startsWith('ai_tts') ? 'audio'
            : 'video',
          url: result.result_url,
          filename: result.result_url.split('/').pop() || 'output',
          size: 0,
        }]
      : [];

    useCanvasStore.getState().setNodeOutput(nodeId, artifacts);
    useCanvasStore.getState().setNodeStatus(nodeId, 'completed', 100);

    // 节点执行成功后自动将产出加入时间轴
    if (artifacts.length > 0) {
      const { addClip, data: timelineData } = useTimelineStore.getState();
      for (const artifact of artifacts) {
        const trackType: TrackType = artifact.type === 'audio' ? 'audio' : 'video';
        const targetTrack = timelineData.tracks.find((t) => t.type === trackType);
        if (!targetTrack) continue;

        const duration = artifact.type === 'image' ? 3 : 5;
        const tk = localStorage.getItem('access_token') || '';
        const isInt = artifact.url.startsWith('/api/');
        const isExt = artifact.url.startsWith('http://') || artifact.url.startsWith('https://');
        let mediaUrl: string;
        if (isInt) mediaUrl = `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}token=${tk}`;
        else if (isExt) mediaUrl = artifact.url;
        else mediaUrl = `/api/v1/media/${artifact.url.replace(/^\//, '')}?token=${tk}`;

        addClip(targetTrack.id, {
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          trackId: targetTrack.id,
          start: timelineData.currentTime,
          end: timelineData.currentTime + duration,
          mediaUrl,
          mediaType: artifact.type as 'image' | 'video' | 'audio',
          label: node.data.label || node.data.subtype,
          nodeId,
        });

        // TTS 产出：同时往字幕轨添加字幕片段
        if (artifact.type === 'audio') {
          const subtitleTrack = timelineData.tracks.find((t) => t.type === 'subtitle');
          if (subtitleTrack) {
            const subtitleText = ((node.data.params?.text as string) || (node.data.params?.prompt as string)) ?? '';
            addClip(subtitleTrack.id, {
              id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              trackId: subtitleTrack.id,
              start: timelineData.currentTime,
              end: timelineData.currentTime + duration,
              mediaUrl: '',
              mediaType: 'subtitle',
              subtitleText,
              label: subtitleText.length > 20 ? subtitleText.slice(0, 20) + '…' : subtitleText || node.data.label || node.data.subtype,
              nodeId,
            });
          }
        }
      }
    }

    return result;
  } catch (err: any) {
    useCanvasStore.getState().setNodeError(nodeId, getErrorMessage(err, 'node_execute'));
    throw err;
  }
}

// ── 拓扑排序 ──

function topologicalSort(nodes: CanvasNode[], edges: CanvasEdge[]): string[][] {
  const executableIds = new Set(
    nodes.filter((n) => isExecutable(n.data.subtype)).map((n) => n.id)
  );

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const id of executableIds) {
    inDegree.set(id, 0);
    adjacency.set(id, new Set());
  }

  for (const edge of edges) {
    if (executableIds.has(edge.source) && executableIds.has(edge.target)) {
      const targets = adjacency.get(edge.source);
      if (targets) targets.add(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  const layers: string[][] = [];
  let queue = [...executableIds].filter((id) => (inDegree.get(id) || 0) === 0);

  while (queue.length > 0) {
    layers.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const target of adjacency.get(id) || []) {
        const deg = (inDegree.get(target) || 1) - 1;
        inDegree.set(target, deg);
        if (deg === 0) nextQueue.push(target);
      }
    }
    queue = nextQueue;
  }

  return layers;
}

// ── 全工作流编排 ──

export interface WorkflowExecutionStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  totalNodes: number;
  completedNodes: number;
  failedNodeId: string | null;
  error: string | null;
}

let currentExecutionStatus: WorkflowExecutionStatus = {
  state: 'idle',
  totalNodes: 0,
  completedNodes: 0,
  failedNodeId: null,
  error: null,
};

let cancelRequested = false;

export function getExecutionStatus(): WorkflowExecutionStatus {
  return { ...currentExecutionStatus };
}

export function cancelWorkflowExecution(): void {
  cancelRequested = true;
}

export async function executeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

  const executableNodes = nodes.filter((n) => isExecutable(n.data.subtype));
  const totalNodes = executableNodes.length;

  if (totalNodes === 0) {
    return { state: 'completed', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null };
  }

  currentExecutionStatus = {
    state: 'running',
    totalNodes,
    completedNodes: 0,
    failedNodeId: null,
    error: null,
  };
  cancelRequested = false;

  let completedNodes = 0;

  for (const layer of layers) {
    if (cancelRequested) {
      currentExecutionStatus.state = 'failed';
      currentExecutionStatus.error = '用户取消';
      break;
    }

    const results = await Promise.allSettled(
      layer.map((nodeId) => executeNode(nodeId))
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        completedNodes++;
      } else {
        currentExecutionStatus.state = 'failed';
        currentExecutionStatus.failedNodeId = layer[i];
        currentExecutionStatus.error = r.reason?.message || '节点执行失败';
        currentExecutionStatus.completedNodes = completedNodes;
        return { ...currentExecutionStatus };
      }
    }

    currentExecutionStatus.completedNodes = completedNodes;
  }

  if (currentExecutionStatus.state === 'running') {
    currentExecutionStatus.state = 'completed';
  }

  return { ...currentExecutionStatus };
}

// ── 断点续执行 ──

export async function resumeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

  // 过滤掉已完成节点，只执行 idle/pending/failed 的节点
  const pendingLayers = layers
    .map((layer) =>
      layer.filter((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        return node && node.data.status !== 'completed';
      })
    )
    .filter((layer) => layer.length > 0);

  const executableNodes = nodes.filter(
    (n) => isExecutable(n.data.subtype) && n.data.status !== 'completed'
  );
  const totalNodes = executableNodes.length;

  if (totalNodes === 0) {
    return { state: 'completed', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null };
  }

  currentExecutionStatus = {
    state: 'running',
    totalNodes,
    completedNodes: 0,
    failedNodeId: null,
    error: null,
  };
  cancelRequested = false;

  let completedNodes = 0;

  for (const layer of pendingLayers) {
    if (cancelRequested) {
      currentExecutionStatus.state = 'failed';
      currentExecutionStatus.error = '用户取消';
      break;
    }

    const results = await Promise.allSettled(
      layer.map((nodeId) => executeNode(nodeId))
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        completedNodes++;
      } else {
        currentExecutionStatus.state = 'failed';
        currentExecutionStatus.failedNodeId = layer[i];
        currentExecutionStatus.error = r.reason?.message || '节点执行失败';
        currentExecutionStatus.completedNodes = completedNodes;
        return { ...currentExecutionStatus };
      }
    }

    currentExecutionStatus.completedNodes = completedNodes;
  }

  if (currentExecutionStatus.state === 'running') {
    currentExecutionStatus.state = 'completed';
  }

  return { ...currentExecutionStatus };
}
