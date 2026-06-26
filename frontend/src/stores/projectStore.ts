import { create } from 'zustand';
import type { Project } from '@/types/project';
import { createEmptyProject } from '@/types/project';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { projectApi, workflowApi } from '@/utils/apiClient';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;

  // 项目操作
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  loadProjects: () => Promise<void>;
  saveCurrentProject: () => Promise<void>;
  loadProjectToCanvas: (projectId: string) => Promise<boolean>;
}

// ── 前后端数据转换 ──

/** 后端 ProjectResponse → 前端 Project */
function toFrontendProject(p: {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: p.id,
    name: p.name,
    description: p.description || undefined,
    thumbnailUrl: p.cover_url || undefined,
    canvasNodes: [],
    canvasEdges: [],
    timelineData: {
      duration: 30,
      tracks: [],
      currentTime: 0,
      zoom: 1,
    },
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** 前端 CanvasNode → 后端 NodeCreateRequest */
function toNodeCreate(n: CanvasNode) {
  return {
    id: n.id,
    node_type: n.data.type,
    label: n.data.label,
    position_x: n.position.x,
    position_y: n.position.y,
    config: { ...n.data } as Record<string, unknown>,
  };
}

/** 前端 CanvasEdge → 后端 EdgeCreateRequest */
function toEdgeCreate(e: CanvasEdge) {
  return {
    id: e.id,
    source_node_id: e.source,
    target_node_id: e.target,
    source_port: e.sourceHandle || null,
    target_port: e.targetHandle || null,
  };
}

/** 后端 NodeResponse → 前端 CanvasNode */
function toCanvasNode(n: {
  id: string;
  node_type: string;
  label: string | null;
  position_x: number;
  position_y: number;
  config: Record<string, unknown> | null;
}): CanvasNode {
  const config = n.config || {};
  return {
    id: n.id,
    type: n.node_type,
    position: { x: n.position_x, y: n.position_y },
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

/** 后端 EdgeResponse → 前端 CanvasEdge */
function toCanvasEdge(e: {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_port: string | null;
  target_port: string | null;
}): CanvasEdge {
  return {
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    sourceHandle: e.source_port || undefined,
    targetHandle: e.target_port || undefined,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  isLoading: false,

  createProject: async (name) => {
    const resp = await projectApi.create(name);
    const project = toFrontendProject(resp);
    set((state) => ({ projects: [...state.projects, project], currentProject: project }));
    return project;
  },

  deleteProject: async (id) => {
    await projectApi.delete(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
    }));
  },

  updateProject: async (id, updates) => {
    const resp = await projectApi.update(id, {
      name: updates.name,
      description: updates.description,
    });
    const updated = toFrontendProject(resp);
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, ...updated } : p)),
      currentProject: state.currentProject?.id === id
        ? { ...state.currentProject, ...updated }
        : state.currentProject,
    }));
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
  },

  loadProjects: async () => {
    set({ isLoading: true });
    try {
      const resp = await projectApi.list();
      const projects = resp.map(toFrontendProject);
      set({ projects, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  saveCurrentProject: async () => {
    const { currentProject } = get();
    if (!currentProject) return;

    const canvasStore = useCanvasStore.getState();

    // 批量保存工作流节点和边到后端
    await workflowApi.save(currentProject.id, {
      nodes: canvasStore.nodes.map(toNodeCreate),
      edges: canvasStore.edges.map(toEdgeCreate),
    });

    // 更新项目的 updatedAt
    await projectApi.update(currentProject.id, {});

    // 刷新项目列表
    await get().loadProjects();
  },

  loadProjectToCanvas: async (projectId) => {
    try {
      const { nodes, edges } = await workflowApi.loadWorkflow(projectId);
      const canvasNodes = nodes.map(toCanvasNode);
      const canvasEdges = edges.map(toCanvasEdge);

      const hasData = canvasNodes.length > 0 || canvasEdges.length > 0;
      if (hasData) {
        const canvasStore = useCanvasStore.getState();
        canvasStore.setNodes(canvasNodes);
        canvasStore.setEdges(canvasEdges);
      }

      return hasData;
    } catch {
      return false;
    }
  },
}));
