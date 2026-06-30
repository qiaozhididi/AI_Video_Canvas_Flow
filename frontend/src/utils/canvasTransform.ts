/**
 * 画布数据格式转换工具
 *
 * 后端 NodeCreateRequest / EdgeCreateRequest ↔ 前端 CanvasNode / CanvasEdge
 * 供 projectStore.loadProjectToCanvas 和 canvasStore.loadGeneratedWorkflow 共享。
 */
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';

/** 后端 NodeCreateRequest → 前端 CanvasNode */
export function toCanvasNode(n: NodeCreateRequest): CanvasNode {
  const config = (n.config || {}) as Record<string, unknown>;
  return {
    id: n.id,
    type: n.node_type,
    position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
    data: {
      type: (config.type as CanvasNode['data']['type']) || 'input',
      subtype: (config.subtype as CanvasNode['data']['subtype']) || 'text_input',
      label: n.label || (config.label as string) || '未命名',
      params: (config.params as Record<string, unknown>) || {},
      status: (config.status as CanvasNode['data']['status']) || 'idle',
      progress: (config.progress as number) || 0,
      outputArtifacts: (config.outputArtifacts as CanvasNode['data']['outputArtifacts']) || [],
      error: config.error as string | undefined,
    },
  };
}

/** 后端 EdgeCreateRequest → 前端 CanvasEdge */
export function toCanvasEdge(e: EdgeCreateRequest): CanvasEdge {
  return {
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    sourceHandle: e.source_port || undefined,
    targetHandle: e.target_port || undefined,
  };
}
