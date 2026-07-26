import { create } from 'zustand';
import type { WorkflowExecutionStatus } from '@/utils/workflowExecutor';

interface WorkflowExecutionState extends WorkflowExecutionStatus {
  isRunning: boolean;
  /** 内部标志：是否请求了取消 */
  _cancelRequested: boolean;

  // actions
  updateProgress: (patch: Partial<WorkflowExecutionStatus>) => void;
  markCompleted: () => void;
  markFailed: (failedNodeId: string, error: string) => void;
  cancel: () => void;
  reset: () => void;
  isCancelRequested: () => boolean;
}

const INITIAL: WorkflowExecutionStatus = {
  state: 'idle',
  totalNodes: 0,
  completedNodes: 0,
  failedNodeId: null,
  error: null,
};

export const useWorkflowExecutionStore = create<WorkflowExecutionState>((set, get) => ({
  ...INITIAL,
  isRunning: false,
  _cancelRequested: false,

  updateProgress: (patch) =>
    set((state) => ({
      ...state,
      ...patch,
      isRunning: patch.state !== undefined ? patch.state === 'running' : state.isRunning,
    })),

  markCompleted: () => set({ state: 'completed', isRunning: false }),

  markFailed: (failedNodeId, error) =>
    set({ state: 'failed', failedNodeId, error, isRunning: false }),

  cancel: () => set({ _cancelRequested: true }),

  reset: () => set({ ...INITIAL, isRunning: false, _cancelRequested: false }),

  isCancelRequested: () => get()._cancelRequested,
}));
