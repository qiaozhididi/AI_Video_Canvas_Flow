import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowExecutionStore } from './workflowExecutionStore';

describe('workflowExecutionStore', () => {
  beforeEach(() => {
    useWorkflowExecutionStore.getState().reset();
  });

  it('初始状态为 idle', () => {
    const s = useWorkflowExecutionStore.getState();
    expect(s.state).toBe('idle');
    expect(s.totalNodes).toBe(0);
    expect(s.completedNodes).toBe(0);
    expect(s.failedNodeId).toBeNull();
    expect(s.error).toBeNull();
    expect(s.isRunning).toBe(false);
  });

  it('cancel 设置 cancelRequested 标志', () => {
    useWorkflowExecutionStore.getState().cancel();
    expect(useWorkflowExecutionStore.getState().isCancelRequested()).toBe(true);
  });

  it('reset 恢复初始状态并清除 cancelRequested', () => {
    useWorkflowExecutionStore.getState().cancel();
    useWorkflowExecutionStore.getState().reset();
    expect(useWorkflowExecutionStore.getState().state).toBe('idle');
    expect(useWorkflowExecutionStore.getState().isCancelRequested()).toBe(false);
  });

  it('updateProgress 更新进度字段', () => {
    useWorkflowExecutionStore.getState().updateProgress({
      state: 'running',
      totalNodes: 5,
      completedNodes: 2,
    });
    const s = useWorkflowExecutionStore.getState();
    expect(s.state).toBe('running');
    expect(s.totalNodes).toBe(5);
    expect(s.completedNodes).toBe(2);
    expect(s.isRunning).toBe(true);
  });

  it('updateProgress 不传 state 时保持 isRunning', () => {
    useWorkflowExecutionStore.getState().updateProgress({ state: 'running', totalNodes: 5 });
    expect(useWorkflowExecutionStore.getState().isRunning).toBe(true);

    useWorkflowExecutionStore.getState().updateProgress({ completedNodes: 2 });
    expect(useWorkflowExecutionStore.getState().isRunning).toBe(true);
    expect(useWorkflowExecutionStore.getState().completedNodes).toBe(2);
  });

  it('cancel 同步更新 UI 状态为 failed 并停止运行', () => {
    useWorkflowExecutionStore.getState().updateProgress({ state: 'running', totalNodes: 3 });
    expect(useWorkflowExecutionStore.getState().isRunning).toBe(true);

    useWorkflowExecutionStore.getState().cancel();
    const s = useWorkflowExecutionStore.getState();
    expect(s.isCancelRequested()).toBe(true);
    expect(s.state).toBe('failed');
    expect(s.error).toBe('用户取消');
    expect(s.isRunning).toBe(false);
  });
});
