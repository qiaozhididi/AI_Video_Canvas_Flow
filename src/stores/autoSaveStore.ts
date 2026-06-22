import { create } from 'zustand';
import type { StateSnapshot } from '@/types/history';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';

// 延迟引用 historyStore，避免循环依赖
let _historyStore: typeof import('./historyStore').useHistoryStore | null = null;
function getHistoryStore() {
  if (!_historyStore) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./historyStore');
    _historyStore = mod.useHistoryStore;
  }
  return _historyStore!;
}

const AUTOSAVE_KEY = 'ai-canvas-flow-autosave';
const SNAPSHOT_LIMIT = 5;
const AUTOSAVE_INTERVAL = 30_000; // 30秒
const DEBOUNCE_DELAY = 2_000; // 操作后2秒防抖保存

interface AutoSaveState {
  /** 自动保存快照列表 */
  snapshots: StateSnapshot[];
  /** 是否有未保存的修改 */
  isDirty: boolean;
  /** 上次保存时间 */
  lastSavedAt: number | null;
  /** 自动保存定时器 ID */
  intervalId: ReturnType<typeof setInterval> | null;
  /** 防抖定时器 ID */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** 是否正在保存 */
  isSaving: boolean;
  /** 崩溃恢复快照（如果存在） */
  recoverySnapshot: StateSnapshot | null;
}

interface AutoSaveActions {
  /** 标记为脏状态，触发防抖保存 */
  markDirty: () => void;
  /** 立即执行自动保存 */
  saveNow: (source?: StateSnapshot['source'], label?: string) => void;
  /** 创建手动命名版本快照 */
  createNamedSnapshot: (label: string) => void;
  /** 启动定时自动保存 */
  startAutoSave: () => void;
  /** 停止定时自动保存 */
  stopAutoSave: () => void;
  /** 检测崩溃恢复快照 */
  checkRecovery: () => StateSnapshot | null;
  /** 恢复到指定快照 */
  restoreSnapshot: (snapshot: StateSnapshot) => void;
  /** 丢弃恢复快照 */
  discardRecovery: () => void;
  /** 清理所有快照 */
  clearSnapshots: () => void;
}

type AutoSaveStore = AutoSaveState & AutoSaveActions;

function loadSnapshotsFromStorage(): StateSnapshot[] {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveSnapshotsToStorage(snapshots: StateSnapshot[]) {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshots));
}

function createSnapshot(source: StateSnapshot['source'], label?: string): StateSnapshot {
  const canvasStore = useCanvasStore.getState();
  const timelineStore = useTimelineStore.getState();
  const projectStore = useProjectStore.getState();

  return {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: projectStore.currentProject?.id || '',
    nodes: JSON.parse(JSON.stringify(canvasStore.nodes)),
    edges: JSON.parse(JSON.stringify(canvasStore.edges)),
    timelineData: JSON.parse(JSON.stringify(timelineStore.data)),
    timestamp: Date.now(),
    source,
    label,
  };
}

export const useAutoSaveStore = create<AutoSaveStore>((set, get) => ({
  snapshots: loadSnapshotsFromStorage(),
  isDirty: false,
  lastSavedAt: null,
  intervalId: null,
  debounceTimer: null,
  isSaving: false,
  recoverySnapshot: null,

  markDirty: () => {
    set({ isDirty: true });

    // 防抖保存：操作后 2 秒无新操作则保存
    const state = get();
    if (state.debounceTimer) clearTimeout(state.debounceTimer);

    const timer = setTimeout(() => {
      get().saveNow('auto');
    }, DEBOUNCE_DELAY);

    set({ debounceTimer: timer });
  },

  saveNow: (source = 'auto', label) => {
    const state = get();
    if (state.isSaving) return;

    set({ isSaving: true });

    const snapshot = createSnapshot(source, label);
    const snapshots = [...state.snapshots, snapshot];

    // 超出上限，移除最旧的自动快照（保留手动快照）
    let trimmed = snapshots;
    if (trimmed.length > SNAPSHOT_LIMIT * 2) {
      const autoSnapshots = trimmed.filter((s) => s.source === 'auto');
      const manualSnapshots = trimmed.filter((s) => s.source !== 'auto');
      trimmed = [
        ...autoSnapshots.slice(-SNAPSHOT_LIMIT),
        ...manualSnapshots,
      ];
    }

    saveSnapshotsToStorage(trimmed);

    set({
      snapshots: trimmed,
      isDirty: false,
      lastSavedAt: Date.now(),
      isSaving: false,
    });
  },

  createNamedSnapshot: (label) => {
    get().saveNow('manual', label);
  },

  startAutoSave: () => {
    const state = get();
    if (state.intervalId) return; // 已启动

    const id = setInterval(() => {
      const current = get();
      if (current.isDirty) {
        current.saveNow('auto');
      }
    }, AUTOSAVE_INTERVAL);

    set({ intervalId: id });
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
      get().saveNow('auto');
    }
  },

  checkRecovery: () => {
    const state = get();
    const projectStore = useProjectStore.getState();
    const currentProjectId = projectStore.currentProject?.id;

    if (!currentProjectId) return null;

    // 查找当前项目的最新快照
    const projectSnapshots = state.snapshots
      .filter((s) => s.projectId === currentProjectId)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (projectSnapshots.length === 0) return null;

    const latest = projectSnapshots[0];
    const project = projectStore.projects.find((p) => p.id === currentProjectId);

    // 如果快照时间晚于项目最后保存时间，说明有未保存的工作
    if (project && latest.timestamp > new Date(project.updatedAt).getTime()) {
      set({ recoverySnapshot: latest });
      return latest;
    }

    return null;
  },

  restoreSnapshot: (snapshot) => {
    const canvasStore = useCanvasStore.getState();
    const timelineStore = useTimelineStore.getState();

    // 暂停 historyStore 录制，避免恢复操作被记录
    const historyStore = getHistoryStore();
    historyStore.getState().pauseRecording();

    canvasStore.setNodes(snapshot.nodes);
    canvasStore.setEdges(snapshot.edges);
    timelineStore.loadTimeline(snapshot.timelineData);

    historyStore.getState().resumeRecording();
    historyStore.getState().clearHistory();

    set({
      isDirty: false,
      lastSavedAt: Date.now(),
      recoverySnapshot: null,
    });
  },

  discardRecovery: () => {
    set({ recoverySnapshot: null });
  },

  clearSnapshots: () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    set({ snapshots: [], isDirty: false, recoverySnapshot: null });
  },
}));
