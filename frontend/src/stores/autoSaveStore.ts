import { create } from 'zustand';
import type { StateSnapshot } from '@/types/history';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useHistoryStore } from './historyStore';

const AUTOSAVE_KEY = 'ai-canvas-flow-autosave';
const SNAPSHOT_LIMIT = 5;
const AUTOSAVE_INTERVAL = 30_000; // 30秒
const DEBOUNCE_DELAY = 2_000; // 操作后2秒防抖保存

// 日志前缀
const LOG = '[AutoSave]';

interface AutoSaveState {
  snapshots: StateSnapshot[];
  isDirty: boolean;
  lastSavedAt: number | null;
  intervalId: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  isSaving: boolean;
  recoverySnapshot: StateSnapshot | null;
}

interface AutoSaveActions {
  markDirty: () => void;
  markClean: () => void;
  saveNow: (source?: StateSnapshot['source'], label?: string) => void;
  createNamedSnapshot: (label: string) => void;
  startAutoSave: () => void;
  stopAutoSave: () => void;
  checkRecovery: () => StateSnapshot | null;
  restoreSnapshot: (snapshot: StateSnapshot) => void;
  discardRecovery: () => void;
  clearSnapshots: () => void;
}

type AutoSaveStore = AutoSaveState & AutoSaveActions;

function loadSnapshotsFromStorage(): StateSnapshot[] {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    const parsed = data ? JSON.parse(data) : [];
    console.log(`${LOG} 从 localStorage 加载快照: ${parsed.length} 个`);
    return parsed;
  } catch (err) {
    console.error(`${LOG} 加载快照失败:`, err);
    return [];
  }
}

function saveSnapshotsToStorage(snapshots: StateSnapshot[]) {
  try {
    const json = JSON.stringify(snapshots);
    console.log(`${LOG} 写入 localStorage, 快照数: ${snapshots.length}, 数据大小: ${(json.length / 1024).toFixed(1)} KB`);
    localStorage.setItem(AUTOSAVE_KEY, json);
  } catch (err) {
    console.error(`${LOG} 写入 localStorage 失败（可能超出配额）:`, err);
  }
}

function createSnapshot(source: StateSnapshot['source'], label?: string): StateSnapshot {
  const canvasStore = useCanvasStore.getState();
  const timelineStore = useTimelineStore.getState();
  const projectStore = useProjectStore.getState();

  const snapshot: StateSnapshot = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: projectStore.currentProject?.id || '',
    nodes: JSON.parse(JSON.stringify(canvasStore.nodes)),
    edges: JSON.parse(JSON.stringify(canvasStore.edges)),
    timelineData: JSON.parse(JSON.stringify(timelineStore.data)),
    timestamp: Date.now(),
    source,
    label,
  };

  console.log(
    `${LOG} 创建快照 [${source}]: id=${snapshot.id}, ` +
    `projectId=${snapshot.projectId || '(无)'}, ` +
    `nodes=${snapshot.nodes.length}, edges=${snapshot.edges.length}, ` +
    `label=${label || '(无)'}`
  );

  return snapshot;
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
    const prev = get().isDirty;
    set({ isDirty: true });

    if (!prev) {
      console.log(`${LOG} 标记为脏状态，启动防抖保存（${DEBOUNCE_DELAY}ms）`);
    }

    // 防抖保存：操作后 2 秒无新操作则保存
    const state = get();
    if (state.debounceTimer) clearTimeout(state.debounceTimer);

    const timer = setTimeout(() => {
      console.log(`${LOG} 防抖窗口结束，执行保存`);
      get().saveNow('auto');
    }, DEBOUNCE_DELAY);

    set({ debounceTimer: timer });
  },

  markClean: () => {
    set({ isDirty: false, lastSavedAt: Date.now() });
  },

  saveNow: (source = 'auto', label) => {
    const state = get();
    if (state.isSaving) {
      console.warn(`${LOG} 保存正在进行中，跳过本次保存请求 [${source}]`);
      return;
    }

    console.log(`${LOG} 开始保存 [${source}]${label ? ` label="${label}"` : ''}`);
    set({ isSaving: true });

    try {
      const snapshot = createSnapshot(source, label);
      const snapshots = [...state.snapshots, snapshot];

      // 超出上限，移除最旧的自动快照（保留手动快照）
      let trimmed = snapshots;
      if (trimmed.length > SNAPSHOT_LIMIT * 2) {
        const autoSnapshots = trimmed.filter((s) => s.source === 'auto');
        const manualSnapshots = trimmed.filter((s) => s.source !== 'auto');
        const removed = trimmed.length - autoSnapshots.slice(-SNAPSHOT_LIMIT).length - manualSnapshots.length;
        trimmed = [
          ...autoSnapshots.slice(-SNAPSHOT_LIMIT),
          ...manualSnapshots,
        ];
        console.log(`${LOG} 快照数超限，清理了 ${removed} 个旧自动快照`);
      }

      saveSnapshotsToStorage(trimmed);

      set({
        snapshots: trimmed,
        isDirty: false,
        lastSavedAt: Date.now(),
        isSaving: false,
      });

      console.log(`${LOG} 保存完成 [${source}], 当前快照数: ${trimmed.length}`);
    } catch (err) {
      console.error(`${LOG} 保存失败:`, err);
      set({ isSaving: false });
    }
  },

  createNamedSnapshot: (label) => {
    console.log(`${LOG} 创建命名快照: "${label}"`);
    get().saveNow('manual', label);
  },

  startAutoSave: () => {
    const state = get();
    if (state.intervalId) {
      console.log(`${LOG} 自动保存已在运行中，跳过启动`);
      return;
    }

    console.log(`${LOG} 启动定时自动保存，间隔: ${AUTOSAVE_INTERVAL / 1000}s`);
    const id = setInterval(() => {
      const current = get();
      if (current.isDirty) {
        console.log(`${LOG} 定时器触发: 检测到脏状态，执行保存`);
        current.saveNow('auto');
      }
    }, AUTOSAVE_INTERVAL);

    set({ intervalId: id });
  },

  stopAutoSave: () => {
    const state = get();
    console.log(`${LOG} 停止自动保存`);

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
      console.log(`${LOG} 停止前检测到脏状态，执行最后一次保存`);
      get().saveNow('auto');
    }
  },

  checkRecovery: () => {
    const state = get();
    const projectStore = useProjectStore.getState();
    const currentProjectId = projectStore.currentProject?.id;

    console.log(`${LOG} 检查崩溃恢复: projectId=${currentProjectId || '(无)'}`);

    if (!currentProjectId) {
      console.log(`${LOG} 无当前项目，跳过恢复检测`);
      return null;
    }

    // 查找当前项目的最新快照
    const projectSnapshots = state.snapshots
      .filter((s) => s.projectId === currentProjectId)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (projectSnapshots.length === 0) {
      console.log(`${LOG} 当前项目无快照，无需恢复`);
      return null;
    }

    const latest = projectSnapshots[0];
    const project = projectStore.projects.find((p) => p.id === currentProjectId);

    if (project && latest.timestamp > new Date(project.updatedAt).getTime()) {
      const timeDiff = latest.timestamp - new Date(project.updatedAt).getTime();
      console.log(
        `${LOG} 发现可恢复快照! 快照时间=${new Date(latest.timestamp).toLocaleString('zh-CN')}, ` +
        `项目保存时间=${new Date(project.updatedAt).toLocaleString('zh-CN')}, ` +
        `时间差=${(timeDiff / 1000).toFixed(0)}s, ` +
        `nodes=${latest.nodes.length}, edges=${latest.edges.length}`
      );
      set({ recoverySnapshot: latest });
      return latest;
    }

    console.log(`${LOG} 快照不晚于项目保存时间，无需恢复`);
    return null;
  },

  restoreSnapshot: (snapshot) => {
    const canvasStore = useCanvasStore.getState();
    const timelineStore = useTimelineStore.getState();

    console.log(
      `${LOG} 恢复快照: id=${snapshot.id}, ` +
      `nodes=${snapshot.nodes.length}, edges=${snapshot.edges.length}, ` +
      `timestamp=${new Date(snapshot.timestamp).toLocaleString('zh-CN')}`
    );

    // 暂停 historyStore 录制，避免恢复操作被记录
    const historyStore = useHistoryStore;
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

    console.log(`${LOG} 快照恢复完成，历史记录已清空`);
  },

  discardRecovery: () => {
    console.log(`${LOG} 丢弃恢复快照`);
    set({ recoverySnapshot: null });
  },

  clearSnapshots: () => {
    console.log(`${LOG} 清理所有快照`);
    localStorage.removeItem(AUTOSAVE_KEY);
    set({ snapshots: [], isDirty: false, recoverySnapshot: null });
  },
}));
