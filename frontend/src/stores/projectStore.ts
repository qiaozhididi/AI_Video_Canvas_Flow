import { create } from 'zustand';
import type { Project } from '@/types/project';
import { createEmptyProject } from '@/types/project';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;

  // 项目操作
  createProject: (name: string) => Project;
  deleteProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  setCurrentProject: (project: Project | null) => void;
  loadProjects: () => void;
  saveCurrentProject: () => void;
  loadProjectToCanvas: (projectId: string) => boolean;
}

const STORAGE_KEY = 'ai-canvas-flow-projects';

function loadFromStorage(): Project[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveToStorage(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: loadFromStorage(),
  currentProject: null,
  isLoading: false,

  createProject: (name) => {
    const project = createEmptyProject(name);
    set((state) => {
      const projects = [...state.projects, project];
      saveToStorage(projects);
      return { projects, currentProject: project };
    });
    return project;
  },

  deleteProject: (id) => {
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id);
      saveToStorage(projects);
      return {
        projects,
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
      };
    });
  },

  updateProject: (id, updates) => {
    set((state) => {
      const projects = state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      );
      saveToStorage(projects);
      return {
        projects,
        currentProject:
          state.currentProject?.id === id
            ? { ...state.currentProject, ...updates, updatedAt: new Date().toISOString() }
            : state.currentProject,
      };
    });
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
  },

  loadProjects: () => {
    set({ projects: loadFromStorage(), isLoading: false });
  },

  saveCurrentProject: () => {
    const { currentProject, projects } = get();
    if (!currentProject) return;

    // 从 canvasStore 和 timelineStore 读取当前画布数据
    const canvasStore = useCanvasStore.getState();
    const timelineStore = useTimelineStore.getState();

    const updated: Project = {
      ...currentProject,
      canvasNodes: JSON.parse(JSON.stringify(canvasStore.nodes)),
      canvasEdges: JSON.parse(JSON.stringify(canvasStore.edges)),
      timelineData: JSON.parse(JSON.stringify(timelineStore.data)),
      updatedAt: new Date().toISOString(),
    };

    const newProjects = projects.map((p) => (p.id === updated.id ? updated : p));
    saveToStorage(newProjects);
    set({ projects: newProjects, currentProject: updated });
  },

  // 加载项目的画布数据到 canvasStore，返回是否有数据
  loadProjectToCanvas: (projectId) => {
    const project = get().projects.find((p) => p.id === projectId);
    if (!project) return false;

    const hasData = project.canvasNodes.length > 0 || project.canvasEdges.length > 0;
    if (hasData) {
      const canvasStore = useCanvasStore.getState();
      const timelineStore = useTimelineStore.getState();

      canvasStore.setNodes(project.canvasNodes);
      canvasStore.setEdges(project.canvasEdges);
      timelineStore.loadTimeline(project.timelineData);
    }

    return hasData;
  },
}));
