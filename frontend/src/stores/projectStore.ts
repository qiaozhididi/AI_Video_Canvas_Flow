import { create } from 'zustand';
import type { Project } from '@/types/project';
import { createEmptyProject } from '@/types/project';

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
    const updated = {
      ...currentProject,
      updatedAt: new Date().toISOString(),
    };
    const newProjects = projects.map((p) => (p.id === updated.id ? updated : p));
    saveToStorage(newProjects);
    set({ projects: newProjects, currentProject: updated });
  },
}));
