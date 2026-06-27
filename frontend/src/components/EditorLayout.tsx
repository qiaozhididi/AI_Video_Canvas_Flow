import { useEffect } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useHistoryStore } from '@/stores/historyStore';
import { ArrowLeft, Save, Undo2, Redo2, Play, Square, History, Clock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { executeWorkflow, getExecutionStatus, cancelWorkflowExecution } from '@/utils/workflowExecutor';
import type { WorkflowExecutionStatus } from '@/utils/workflowExecutor';

export default function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects, currentProject, setCurrentProject, saveCurrentProject, loadProjectToCanvas, loadProjects } = useProjectStore();
  const { canUndo, canRedo, undo, redo } = useHistoryStore();
  const { startAutoSave, stopAutoSave, checkRecovery, restoreSnapshot, discardRecovery, lastSavedAt, isDirty } = useAutoSaveStore();
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState<{ timestamp: number; actionCount: number } | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowExecutionStatus>({
    state: 'idle', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null
  });

  const handleExecuteWorkflow = async () => {
    if (workflowStatus.state === 'running') return;
    setWorkflowStatus({ ...getExecutionStatus(), state: 'running' });
    try {
      const result = await executeWorkflow();
      setWorkflowStatus(result);
      if (result.state === 'completed') {
        toast.success('工作流执行完成');
      } else if (result.state === 'failed') {
        toast.error(`工作流执行失败: ${result.error}`);
      }
    } catch (err: any) {
      setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: err.message });
      toast.error('工作流执行出错');
    }
  };

  const handleCancelWorkflow = () => {
    cancelWorkflowExecution();
    setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: '用户取消' });
  };

  // 加载项目
  useEffect(() => {
    if (!projectId) return;

    const load = async () => {
      // 确保 projects 已加载
      if (projects.length === 0) {
        await loadProjects();
      }
      const latestProjects = useProjectStore.getState().projects;
      const project = latestProjects.find((p) => p.id === projectId);
      if (project) {
        setCurrentProject(project);
        await loadProjectToCanvas(projectId);
      }
    };
    load();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 启动自动保存
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  // 崩溃恢复检测
  useEffect(() => {
    const snapshot = checkRecovery();
    if (snapshot) {
      setRecoveryInfo({ timestamp: snapshot.timestamp, actionCount: 0 });
      setShowRecoveryDialog(true);
    }
  }, [checkRecovery]);

  // 快捷键绑定
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Z 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Shift+Z 或 Ctrl+Y 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y') && (e.shiftKey || e.key === 'y')) {
        e.preventDefault();
        redo();
      }
      // Ctrl+S 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentProject().then(() => toast.success('项目已保存'));
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, saveCurrentProject]);

  if (!currentProject || currentProject.id !== projectId) {
    return (
      <div className="h-screen flex items-center justify-center bg-canvas-bg">
        <div className="text-center">
          <p className="text-slate-400 mb-4">项目不存在</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm text-white bg-neon-purple rounded-lg hover:opacity-90"
          >
            返回工作台
          </button>
        </div>
      </div>
    );
  }

  const formatLastSaved = () => {
    if (!lastSavedAt) return '未保存';
    const diff = Date.now() - lastSavedAt;
    if (diff < 5000) return '刚刚保存';
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前保存`;
    return `${Math.floor(diff / 60000)}分钟前保存`;
  };

  return (
    <div className="h-screen flex flex-col bg-canvas-bg">
      {/* 顶部工具栏 */}
      <div className="h-11 bg-canvas-panel border-b border-canvas-border flex items-center px-3 gap-2 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded hover:bg-canvas-hover transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>

        <div className="h-5 w-px bg-canvas-border" />

        <h1 className="text-sm font-medium text-slate-200 font-display">
          {currentProject.name}
        </h1>

        {/* 自动保存状态 */}
        <div className="flex items-center gap-1 ml-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-status-warning' : 'bg-status-success'}`} />
          <span className="text-[10px] text-slate-500">{formatLastSaved()}</span>
        </div>

        <div className="flex-1" />

        {/* 撤销/重做 */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`p-1 rounded transition-colors ${canUndo ? 'hover:bg-canvas-hover text-slate-400' : 'text-slate-700 cursor-not-allowed'}`}
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={`p-1 rounded transition-colors ${canRedo ? 'hover:bg-canvas-hover text-slate-400' : 'text-slate-700 cursor-not-allowed'}`}
            title="重做 (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            className="p-1 rounded hover:bg-canvas-hover text-slate-400 transition-colors"
            title="操作历史 (Ctrl+Shift+H)"
          >
            <History className="w-4 h-4" />
          </button>
        </div>

        <div className="h-5 w-px bg-canvas-border" />

        <button
          onClick={() => {
            saveCurrentProject().then(() => toast.success('项目已保存'));
          }}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          保存
        </button>

        <div className="h-5 w-px bg-canvas-border" />

        {workflowStatus.state === 'running' ? (
          <button
            onClick={handleCancelWorkflow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            停止 {workflowStatus.completedNodes}/{workflowStatus.totalNodes}
          </button>
        ) : (
          <button
            onClick={handleExecuteWorkflow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
          >
            <Play className="w-3.5 h-3.5" />
            执行工作流
          </button>
        )}
      </div>

      {/* 主内容区 - 由子路由渲染 */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>

      {/* 崩溃恢复对话框 */}
      {showRecoveryDialog && recoveryInfo && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-canvas-panel border border-canvas-border rounded-xl p-6 w-[420px] shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-status-warning/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-status-warning" />
              </div>
              <div>
                <h3 className="text-base font-medium text-white font-display">发现未保存的工作</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  上次保存于 {new Date(recoveryInfo.timestamp).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-300 mb-5">
              检测到您有未保存的编辑内容，可能是由于浏览器意外关闭导致的。您可以选择恢复这些内容或丢弃。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  discardRecovery();
                  setShowRecoveryDialog(false);
                }}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                丢弃
              </button>
              <button
                onClick={() => {
                  const snapshot = checkRecovery();
                  if (snapshot) restoreSnapshot(snapshot);
                  setShowRecoveryDialog(false);
                }}
                className="px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity"
              >
                恢复
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
