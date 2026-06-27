import { create } from 'zustand';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useHistoryStore } from './historyStore';
import { snapshotApi, type SnapshotResponse } from '@/utils/apiClient';

const SNAPSHOT_LIMIT = 5;
const AUTOSAVE_INTERVAL = 30_000; // 30秒
const DEBOUNCE_DELAY = 2_000; // 操作后2秒防抖保存

// 日志前缀
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
    console.log(`${LOG} 已加载快照列表: ${snapshots.length} 个`);
  },

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
      console.log(`${LOG} 无当前项目，跳过保存`);
      return;
    }
    if (state.isSaving) {
      console.warn(`${LOG} 保存正在进行中，跳过本次保存请求 [${source}]`);
      return;
    }

    console.log(`${LOG} 开始保存 [${source}]${label ? ` label="${label}"` : ''}`);
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

      console.log(
        `${LOG} 保存完成 [${source}] id=${resp.id}, 当前快照数: ${trimmed.length}`,
      );
    } catch (err) {
      console.error(`${LOG} 保存失败:`, err);
      set({ isSaving: false });
    }
  },

  createNamedSnapshot: async (label) => {
    console.log(`${LOG} 创建命名快照: "${label}"`);
    await get().saveNow('manual', label);
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
        void current.saveNow('auto');
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
      void get().saveNow('auto');
    }
  },

  checkRecovery: async () => {
    const projectStore = useProjectStore.getState();
    const currentProjectId = projectStore.currentProject?.id;

    console.log(`${LOG} 检查崩溃恢复: projectId=${currentProjectId || '(无)'}`);

    if (!currentProjectId) {
      console.log(`${LOG} 无当前项目，跳过恢复检测`);
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
          const timeDiff = snapshotTime - projectTime;
          console.log(
            `${LOG} 发现可恢复快照! 快照时间=${new Date(snapshotTime).toLocaleString('zh-CN')}, ` +
            `项目保存时间=${new Date(projectTime).toLocaleString('zh-CN')}, ` +
            `时间差=${(timeDiff / 1000).toFixed(0)}s`,
          );
          set({ recoverySnapshot: latest });
          return latest;
        }
      }

      console.log(`${LOG} 快照不晚于项目保存时间，无需恢复`);
      return null;
    } catch (err: unknown) {
      // 404 = 无快照，正常情况
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        console.log(`${LOG} 当前项目无快照，无需恢复`);
        return null;
      }
      console.error(`${LOG} 检查恢复失败:`, err);
      return null;
    }
  },

  restoreSnapshot: async (snapshot) => {
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id || snapshot.project_id;

    console.log(
      `${LOG} 恢复快照: id=${snapshot.id}, projectId=${projectId}`,
    );

    try {
      await snapshotApi.restore(snapshot.id);

      // 暂停 historyStore 录制，避免恢复操作被记录
      const historyStore = useHistoryStore;
      historyStore.getState().pauseRecording();

      // 重新加载实际 nodes/edges 到本地 stores
      await projectStore.loadProjectToCanvas(projectId);

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

      console.log(`${LOG} 快照恢复完成，历史记录已清空`);
    } catch (err) {
      console.error(`${LOG} 恢复快照失败:`, err);
      throw err;
    }
  },

  discardRecovery: async () => {
    const state = get();
    console.log(`${LOG} 丢弃恢复快照`);
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
    console.log(`${LOG} 清理当前项目所有快照: projectId=${projectId || '(无)'}`);

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
