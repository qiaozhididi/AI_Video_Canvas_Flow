import { create } from 'zustand';
import type { Project } from '@/types/project';
import { createEmptyProject } from '@/types/project';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { useAutoSaveStore } from './autoSaveStore';
import { projectApi, workflowApi, snapshotApi } from '@/utils/apiClient';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import { toCanvasNode, toCanvasEdge } from '@/utils/canvasTransform';

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
  refreshCurrentProject: () => Promise<void>;
}

// ── 前后端数据转换 ──

/** 后端 ProjectResponse → 前端 Project */
function toFrontendProject(p: {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  node_count?: number;
  owner_id: string;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: p.id,
    name: p.name,
    description: p.description || undefined,
    thumbnailUrl: p.cover_url || undefined,
    nodeCount: p.node_count || 0,
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

    // 从画布节点产出中提取第一张图片作为封面
    const firstImage = canvasStore.nodes
      .flatMap((n) => n.data.outputArtifacts)
      .find((a) => a.type === 'image' && a.url);
    const coverUrl = firstImage?.url;

    // 更新项目元数据（updatedAt + cover_url）
    await projectApi.update(currentProject.id, { cover_url: coverUrl });

    // 刷新项目列表
    await get().loadProjects();

    // 重置 autoSaveStore 的脏状态
    useAutoSaveStore.getState().markClean();
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

      // 加载项目快照列表，填充 autoSaveStore
      try {
        const snapshots = await snapshotApi.list(projectId);
        useAutoSaveStore.getState().setSnapshots(snapshots);

        // 从最新 auto 快照恢复 timelineData（静默恢复，不触发崩溃恢复对话框）
        const latestAutoSnapshot = snapshots
          .filter((s) => s.source === 'auto')
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        if (latestAutoSnapshot?.snapshot_data?.timelineData) {
          useTimelineStore.getState().loadTimeline(latestAutoSnapshot.snapshot_data.timelineData);
        }
      } catch (err) {
        console.error('[ProjectStore] 加载快照列表失败:', err);
      }

      return hasData;
    } catch {
      return false;
    }
  },

  refreshCurrentProject: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const resp = await projectApi.get(currentProject.id);
      // 只更新元数据（updatedAt 等），保留 canvas/timeline 数据
      set({
        currentProject: {
          ...currentProject,
          name: resp.name,
          description: resp.description || undefined,
          updatedAt: resp.updated_at,
        },
      });
    } catch (err) {
      console.error('[ProjectStore] 刷新当前项目失败:', err);
    }
  },
}));
