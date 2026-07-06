import { create } from 'zustand';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useHistoryStore } from './historyStore';
import { toPng } from 'html-to-image';
import { snapshotApi, projectApi, type SnapshotResponse } from '@/utils/apiClient';

/** 截取画布预览图并上传为项目封面（不走媒体库，覆盖旧封面） */
async function updateCanvasCover(projectId: string) {
  try {
    const canvasEl = document.querySelector('.react-flow') as HTMLElement;
    if (!canvasEl) return;
    const dataUrl = await toPng(canvasEl, {
      quality: 0.6,
      pixelRatio: 0.5,
      filter: (node: HTMLElement) => {
        return !node.classList?.contains('react-flow__controls') &&
               !node.classList?.contains('react-flow__minimap') &&
               !node.classList?.contains('react-flow__attribution');
      },
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const formData = new FormData();
    formData.append('file', blob, 'cover.png');
    const token = localStorage.getItem('access_token') || '';
    // 使用专用封面上传接口：覆盖旧封面，不进媒体库
    const uploadRes = await fetch(`/api/v1/projects/${projectId}/cover`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (uploadRes.ok) {
      const data = await uploadRes.json();
      // 更新 projectStore 中的 cover_url
      const projStore = useProjectStore.getState();
      if (projStore.currentProject) {
        projStore.setCurrentProject({ ...projStore.currentProject, thumbnailUrl: data.cover_url });
      }
    }
  } catch {
    // 封面截图/上传失败不影响主流程
  }
}
const SNAPSHOT_LIMIT = 5;
const AUTOSAVE_INTERVAL = 30_000; // 30秒
const DEBOUNCE_DELAY = 2_000; // 操作后2秒防抖保存

// 日志前缀（仅用于 console.warn / console.error）
const LOG = '[AutoSave]';

interface AutoSaveState {
  snapshots: SnapshotResponse[];
  isDirty: boolean;
  lastSavedAt: number | null;
  intervalId: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  isSaving: boolean;
  recoverySnapshot: SnapshotResponse | null;
}

interface AutoSaveActions {
  setSnapshots: (snapshots: SnapshotResponse[]) => void;
  markDirty: () => void;
  markClean: () => void;
  saveNow: (source?: 'auto' | 'manual', label?: string) => Promise<void>;
  createNamedSnapshot: (label: string) => Promise<void>;
  startAutoSave: () => void;
  stopAutoSave: () => void;
  checkRecovery: () => Promise<SnapshotResponse | null>;
  restoreSnapshot: (snapshot: SnapshotResponse) => Promise<void>;
  discardRecovery: () => Promise<void>;
  clearSnapshots: () => Promise<void>;
}

type AutoSaveStore = AutoSaveState & AutoSaveActions;

function buildSnapshotData() {
  const canvasStore = useCanvasStore.getState();
  const timelineStore = useTimelineStore.getState();
  return {
    nodes: JSON.parse(JSON.stringify(canvasStore.nodes)) as CanvasNode[],
    edges: JSON.parse(JSON.stringify(canvasStore.edges)) as CanvasEdge[],
    timelineData: JSON.parse(JSON.stringify(timelineStore.data)) as TimelineData,
  };
}

export const useAutoSaveStore = create<AutoSaveStore>((set, get) => ({
  snapshots: [],
  isDirty: false,
  lastSavedAt: null,
  intervalId: null,
  debounceTimer: null,
  isSaving: false,
  recoverySnapshot: null,

  setSnapshots: (snapshots) => {
    set({ snapshots });
  },

  markDirty: () => {
    set({ isDirty: true });

    // 防抖保存：操作后 2 秒无新操作则保存
    const state = get();
    if (state.debounceTimer) clearTimeout(state.debounceTimer);

    const timer = setTimeout(() => {
      void get().saveNow('auto');
    }, DEBOUNCE_DELAY);

    set({ debounceTimer: timer });
  },

  markClean: () => {
    set({ isDirty: false, lastSavedAt: Date.now() });
  },

  saveNow: async (source = 'auto', label) => {
    const state = get();
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id;

    if (!projectId) {
      return;
    }
    if (state.isSaving) {
      console.warn(`${LOG} 保存正在进行中，跳过本次保存请求 [${source}]`);
      return;
    }

    set({ isSaving: true });

    try {
      const snapshotData = buildSnapshotData();
      const resp = await snapshotApi.create(projectId, {
        source,
        label,
        snapshot_data: snapshotData,
      });

      // 后端已处理 5 auto 上限，前端只需把新快照插入列表头部
      const newSnapshots = [resp, ...state.snapshots];
      // 仅对 auto 类型在前端做兜底裁剪（后端已清理，保持防御）
      const autoCount = newSnapshots.filter((s) => s.source === 'auto').length;
      let trimmed = newSnapshots;
      if (autoCount > SNAPSHOT_LIMIT) {
        // 移除最旧的 auto 快照（列表已按 created_at DESC 排序，从尾部找 auto）
        const lastAutoIdx = newSnapshots
          .map((s, i) => ({ s, i }))
          .filter((x) => x.s.source === 'auto')
          .pop()?.i;
        if (lastAutoIdx !== undefined) {
          trimmed = newSnapshots.filter((_, i) => i !== lastAutoIdx);
        }
      }

      set({
        snapshots: trimmed,
        isDirty: false,
        lastSavedAt: Date.now(),
        isSaving: false,
      });

      // 自动更新项目封面：截取画布预览图上传
      void updateCanvasCover(projectId);
    } catch (err) {
      console.error(`${LOG} 保存失败:`, err);
      set({ isSaving: false });
    }
  },

  createNamedSnapshot: async (label) => {
    await get().saveNow('manual', label);
  },

  startAutoSave: () => {
    const state = get();
    if (state.intervalId) {
      return;
    }

    const id = setInterval(() => {
      const current = get();
      if (current.isDirty) {
        void current.saveNow('auto');
      }
    }, AUTOSAVE_INTERVAL);

    set({ intervalId: id });

    // 首次加载时立即截取画布封面（等画布渲染完成）
    const projectId = useProjectStore.getState().currentProject?.id;
    if (projectId) {
      setTimeout(() => void updateCanvasCover(projectId), 3000);
    }
  },

  stopAutoSave: () => {
    const state = get();

    if (state.intervalId) {
      clearInterval(state.intervalId);
      set({ intervalId: null });
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      set({ debounceTimer: null });
    }
    // 停止前保存一次
    if (state.isDirty) {
      void get().saveNow('auto');
    }
  },

  checkRecovery: async () => {
    const projectStore = useProjectStore.getState();
    const currentProjectId = projectStore.currentProject?.id;

    if (!currentProjectId) {
      return null;
    }

    try {
      const latest = await snapshotApi.getLatest(currentProjectId);
      const project = projectStore.projects.find(
        (p) => p.id === currentProjectId,
      );

      if (project) {
        const snapshotTime = new Date(latest.created_at).getTime();
        const projectTime = new Date(project.updatedAt).getTime();
        if (snapshotTime > projectTime) {
          set({ recoverySnapshot: latest });
          return latest;
        }
      }

      return null;
    } catch (err: unknown) {
      // 404 = 无快照，正常情况
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        return null;
      }
      console.error(`${LOG} 检查恢复失败:`, err);
      return null;
    }
  },

  restoreSnapshot: async (snapshot) => {
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id || snapshot.project_id;

    try {
      await snapshotApi.restore(snapshot.id);

      // 暂停 historyStore 录制，避免恢复操作被记录
      const historyStore = useHistoryStore;
      historyStore.getState().pauseRecording();

      // 重新加载实际 nodes/edges 到本地 stores
      await projectStore.loadProjectToCanvas(projectId);

      // 刷新 currentProject.updatedAt，避免 checkRecovery 误判重复弹出恢复对话框
      // （restore 端点会在后端更新 project.updated_at，需同步到前端）
      await projectStore.refreshCurrentProject();

      // 还原 timelineData（从快照数据中读取）
      const timelineStore = useTimelineStore.getState();
      timelineStore.loadTimeline(snapshot.snapshot_data.timelineData);

      historyStore.getState().resumeRecording();
      historyStore.getState().clearHistory();

      set({
        isDirty: false,
        lastSavedAt: Date.now(),
        recoverySnapshot: null,
      });
    } catch (err) {
      console.error(`${LOG} 恢复快照失败:`, err);
      throw err;
    }
  },

  discardRecovery: async () => {
    const state = get();
    if (state.recoverySnapshot) {
      try {
        await snapshotApi.delete(state.recoverySnapshot.id);
      } catch (err) {
        console.error(`${LOG} 删除恢复快照失败（静默）:`, err);
      }
    }
    set({ recoverySnapshot: null });
  },

  clearSnapshots: async () => {
    const state = get();
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id;

    if (!projectId) {
      set({ snapshots: [], isDirty: false, recoverySnapshot: null });
      return;
    }

    // 遍历逐个删除（不新增批量端点，保持 API 简洁）
    for (const s of state.snapshots) {
      try {
        await snapshotApi.delete(s.id);
      } catch (err) {
        console.error(`${LOG} 删除快照失败 id=${s.id}:`, err);
      }
    }

    set({ snapshots: [], isDirty: false, recoverySnapshot: null });
  },
}));
