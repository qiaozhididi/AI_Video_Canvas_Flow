/**
 * 工作流编排引擎
 *
 * 支持：
 * - 单节点执行：读取节点参数 + 上游输出 → 调 render API → 轮询状态 → 更新画布
 * - 全工作流编排：拓扑排序 → 按层并行执行 → 任一失败停止
 */

import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { renderApi, aiApi } from '@/utils/apiClient';
import type { CanvasNode, CanvasEdge, NodeSubtype, Artifact } from '@/types/canvas';
import type { RenderTaskResponse } from '@/utils/apiClient';

// ── 节点可执行性判定 ──

const EXECUTABLE_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_video', 'text_to_speech',
  'upscale', 'style_transfer', 'remove_bg', 'extend_image',
  'video_output', 'image_output', 'audio_output',
]);

const AI_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_video', 'text_to_speech',
]);

/** 节点 subtype → 后端 task_type 映射 */
function getTaskType(subtype: NodeSubtype): string {
  if (subtype === 'text_to_image') return 'ai_text2img';
  if (subtype === 'image_to_video') return 'ai_img2video';
  if (subtype === 'text_to_speech') return 'ai_tts';
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
            type: 'image', // 使用 image 类型以通过 URL 检查
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
        const defaultModel = await aiApi.getDefaultModel();
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

  const task = await renderApi.create({
    project_id: projectId,
    task_type: taskType,
    node_id: nodeId,
    model_id: modelId,
    prompt,
    input_artifacts: inputPayload,
  });

  useCanvasStore.getState().setNodeStatus(nodeId, 'running', 0);

  try {
    const result = await renderApi.poll(task.id, 2000, (progress, status) => {
      useCanvasStore.getState().setNodeStatus(nodeId, status as any, Math.round(progress));
    });

    const artifacts: Artifact[] = result.result_url
      ? [{
          id: `artifact-${Date.now()}`,
          type: (node.data.subtype === 'image_output' || node.data.subtype === 'upscale') ? 'image'
            : taskType.startsWith('ai_text2img') ? 'image'
            : taskType.startsWith('ai_img2video') ? 'video'
            : taskType.startsWith('ai_tts') ? 'audio'
            : 'video',
          url: result.result_url,
          filename: result.result_url.split('/').pop() || 'output',
          size: 0,
        }]
      : [];

    useCanvasStore.getState().setNodeOutput(nodeId, artifacts);
    useCanvasStore.getState().setNodeStatus(nodeId, 'completed', 100);

    return result;
  } catch (err: any) {
    useCanvasStore.getState().setNodeError(nodeId, err?.message || '执行失败');
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
      adjacency.get(edge.source)!.add(edge.target);
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
