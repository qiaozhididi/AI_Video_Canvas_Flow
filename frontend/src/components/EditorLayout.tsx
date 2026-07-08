import { useEffect, useState, useRef } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useCollabStore } from '@/stores/collabStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useAuthStore } from '@/stores/authStore';
import { ArrowLeft, Save, Undo2, Redo2, Play, Square, History, Clock, Sparkles, RotateCw, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { executeWorkflow, getExecutionStatus, cancelWorkflowExecution, executeNode, isExecutable, resumeWorkflow } from '@/utils/workflowExecutor';
import type { WorkflowExecutionStatus } from '@/utils/workflowExecutor';
import AiGenerateModal from './AiGenerateModal';
import ShortcutHelpModal from './canvas/ShortcutHelpModal';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';
import { snapshotApi } from '@/utils/apiClient';

// 在线用户头像配色（按 user_id hash 选取）
const AVATAR_COLORS = [
  'bg-purple-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-rose-500',
];

function getAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getAvatarText(username: string): string {
  if (!username) return '?';
  // CJK 字符取 1 个，ASCII 取前 2 个
  const isCJK = /[\u4e00-\u9fff]/.test(username[0]);
  return isCJK ? username.slice(0, 1) : username.slice(0, 2).toUpperCase();
}

export default function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects, currentProject, setCurrentProject, saveCurrentProject, loadProjectToCanvas, loadProjects } = useProjectStore();
  const { canUndo, canRedo, undo, redo } = useHistoryStore();
  const { startAutoSave, stopAutoSave, checkRecovery, restoreSnapshot, discardRecovery, lastSavedAt, isDirty } = useAutoSaveStore();
  const onlineUsers = useCollabStore((s) => s.onlineUsers);
  const currentUser = useAuthStore((s) => s.user);
  // 响应式订阅：是否存在可重试的节点（失败或未执行）
  const hasRetryableNodes = useCanvasStore((s) =>
    s.nodes.some((n) => isExecutable(n.data.subtype) && (n.data.status === 'failed' || n.data.status === 'idle'))
  );
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState<{ timestamp: number; actionCount: number } | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowExecutionStatus>({
    state: 'idle', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null
  });
  const [showAiModal, setShowAiModal] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showSaveDropdown, setShowSaveDropdown] = useState(false);
  // 标记刚退出编辑态，避免 Escape 取消重命名后同时取消节点选中
  const justExitedEditingRef = useRef(false);

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

  const handleResumeWorkflow = async () => {
    if (workflowStatus.state === 'running') return;
    setWorkflowStatus({ ...getExecutionStatus(), state: 'running' });
    try {
      const result = await resumeWorkflow();
      setWorkflowStatus(result);
      if (result.state === 'completed') {
        toast.success('断点续执行完成');
      } else if (result.state === 'failed') {
        toast.error(`断点续执行失败: ${result.error}`);
      }
    } catch (err: any) {
      setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: err.message });
      toast.error('断点续执行出错');
    }
  };

  const handleAiGenerated = (
    nodes: NodeCreateRequest[],
    edges: EdgeCreateRequest[],
    mode: 'replace' | 'append',
  ) => {
    useCanvasStore.getState().loadGeneratedWorkflow(nodes, edges, mode);
  };

  // 加载项目
  useEffect(() => {
    if (!projectId) return;

    const load = async () => {
      // 始终重新加载项目列表，确保新建/克隆的项目也能找到
      await loadProjects();
      const latestProjects = useProjectStore.getState().projects;
      const project = latestProjects.find((p) => p.id === projectId);
      if (project) {
        setCurrentProject(project);
        await loadProjectToCanvas(projectId);
      }
    };
    load();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 协作：连接 collabStore + 订阅远端变更应用到 canvasStore
  useEffect(() => {
    if (!projectId) return;

    const { connect, onNodeUpdate, onEdgeUpdate } = useCollabStore.getState();
    const { applyRemoteNodeUpdate, applyRemoteEdgeUpdate } = useCanvasStore.getState();

    connect(projectId);
    // 签名直接匹配：onNodeUpdate callback 接收 NodeUpdatePayload，applyRemoteNodeUpdate 同签名
    const unsubNode = onNodeUpdate(applyRemoteNodeUpdate);
    const unsubEdge = onEdgeUpdate(applyRemoteEdgeUpdate);

    return () => {
      unsubNode();
      unsubEdge();
      useCollabStore.getState().disconnect();
    };
  }, [projectId]);

  // 启动自动保存
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, [startAutoSave, stopAutoSave]);

  // 崩溃恢复检测
  useEffect(() => {
    void (async () => {
      const snapshot = await checkRecovery();
      if (snapshot) {
        setRecoveryInfo({
          timestamp: new Date(snapshot.created_at).getTime(),
          actionCount: 0,
        });
        setShowRecoveryDialog(true);
      }
    })();
  }, [checkRecovery]);

  // 快捷键绑定
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入框聚焦时不触发（避免影响文本编辑）—— 但 Escape 例外（用于退出编辑态）
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape：优先级 链 —— 编辑态 > 帮助面板 > 选中
      if (e.key === 'Escape') {
        // 如果刚退出编辑态（CanvasNode 的 onKeyDown 先于 window keydown 触发），
        // 跳过取消选中，避免 Escape 取消重命名的同时意外清除选中状态
        if (justExitedEditingRef.current) {
          justExitedEditingRef.current = false;
          e.preventDefault();
          return;
        }
        const { editingNodeId, selectedNodeIds } = useCanvasStore.getState();
        if (editingNodeId !== null) {
          e.preventDefault();
          useCanvasStore.getState().setEditingNodeId(null);
          justExitedEditingRef.current = true;
          return;
        }
        if (showShortcutHelp) {
          e.preventDefault();
          setShowShortcutHelp(false);
          return;
        }
        if (selectedNodeIds.length > 0) {
          e.preventDefault();
          useCanvasStore.getState().setSelectedNodeIds([]);
          return;
        }
        return;
      }

      if (isInputFocused) return;

      // 模态框打开时，只保留 Ctrl+S/Ctrl+Z 等通用快捷键，跳过画布操作
      const modalOpen = showAiModal || showShortcutHelp;

      // F2：重命名选中节点（仅单选时；模态框中不触发）
      if (e.key === 'F2' && !modalOpen) {
        const { selectedNodeIds } = useCanvasStore.getState();
        if (selectedNodeIds.length === 1) {
          e.preventDefault();
          useCanvasStore.getState().setEditingNodeId(selectedNodeIds[0]);
        }
        return;
      }

      // F5：执行选中节点（仅单选且 isExecutable 时；模态框中只阻止刷新）
      if (e.key === 'F5') {
        e.preventDefault();
        if (modalOpen) return;
        const { selectedNodeIds, nodes } = useCanvasStore.getState();
        if (selectedNodeIds.length === 1) {
          const node = nodes.find((n) => n.id === selectedNodeIds[0]);
          if (node && isExecutable(node.data.subtype)) {
            void executeNode(node.id).catch((err) => {
              toast.error(`执行失败: ${err?.message || '未知错误'}`);
            });
          }
        }
        return;
      }

      // Ctrl/Cmd + / ：打开快捷键帮助面板
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcutHelp(true);
        return;
      }

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
      // Ctrl/Cmd+C 复制选中节点（模态框中不触发）
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey && !modalOpen) {
        const { nodes, edges, selectedNodeIds } = useCanvasStore.getState();
        if (selectedNodeIds.length > 0) {
          const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
          const internalEdges = edges.filter(
            (ed) => selectedNodeIds.includes(ed.source) && selectedNodeIds.includes(ed.target)
          );
          useClipboardStore.getState().copy(selectedNodes, internalEdges);
          e.preventDefault();
        }
      }

      // Ctrl/Cmd+V 粘贴（模态框中不触发）
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey && !modalOpen) {
        const pasted = useClipboardStore.getState().paste();
        if (pasted) {
          useCanvasStore.getState().addPastedNodes(pasted.nodes, pasted.edges);
          e.preventDefault();
        }
      }

      // Ctrl/Cmd+A 全选（模态框中不触发）
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !modalOpen) {
        useCanvasStore.getState().selectAll();
        e.preventDefault();
      }

      // Ctrl+S 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentProject()
          .then(() => toast.success('项目已保存'))
          .catch((err: any) => toast.error(`保存失败: ${err.message || '未知错误'}`));
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, saveCurrentProject, showShortcutHelp]);

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

        {/* 在线用户列表 */}
        {onlineUsers.length > 0 && (
          <div className="flex items-center mr-2">
            {onlineUsers.slice(0, 5).map((u, idx) => {
              const isSelf = currentUser?.id === u.user_id;
              return (
                <div
                  key={u.sid}
                  title={`${u.username}${isSelf ? ' (你)' : ''}`}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-white border-2 ${getAvatarColor(u.user_id)} ${idx > 0 ? '-ml-1.5' : ''} ${isSelf ? 'border-neon-blue' : 'border-canvas-panel'}`}
                >
                  {getAvatarText(u.username)}
                </div>
              );
            })}
            {onlineUsers.length > 5 && (
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-slate-300 bg-canvas-hover border-2 border-canvas-panel -ml-1.5">
                +{onlineUsers.length - 5}
              </div>
            )}
          </div>
        )}

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

        <div className="relative flex items-center">
          <button
            onClick={async () => {
              try {
                await saveCurrentProject();
                toast.success('项目已保存');
              } catch (err: any) {
                toast.error(`保存失败: ${err.message || '未知错误'}`);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded-l transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            保存
          </button>
          <button
            onClick={() => setShowSaveDropdown((v) => !v)}
            className="flex items-center px-1.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded-r transition-colors border-l border-canvas-border"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSaveDropdown && (
            <>
              {/* 点击外部关闭 */}
              <div className="fixed inset-0 z-40" onClick={() => setShowSaveDropdown(false)} />
              <div className="absolute top-full right-0 mt-1 w-40 bg-canvas-panel border border-canvas-border rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={async () => {
                    setShowSaveDropdown(false);
                    const versionName = window.prompt('请输入版本快照名称：');
                    if (versionName === null) return;
                    try {
                      const { useCanvasStore: canvasStore } = await import('@/stores/canvasStore');
                      const { useTimelineStore: timelineStore } = await import('@/stores/timelineStore');
                      const snapshotData = {
                        nodes: JSON.parse(JSON.stringify(canvasStore.getState().nodes)),
                        edges: JSON.parse(JSON.stringify(canvasStore.getState().edges)),
                        timelineData: JSON.parse(JSON.stringify(timelineStore.getState().data)),
                      };
                      await snapshotApi.create(projectId!, {
                        source: 'manual',
                        name: versionName || null,
                        snapshot_data: snapshotData,
                      });
                      toast.success(versionName ? `版本快照「${versionName}」已创建` : '版本快照已创建');
                    } catch (err: any) {
                      toast.error(`创建快照失败: ${err.message || '未知错误'}`);
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-hover hover:text-white transition-colors"
                >
                  创建版本快照
                </button>
              </div>
            </>
          )}
        </div>

        <div className="h-5 w-px bg-canvas-border" />

        <button
          onClick={() => setShowAiModal(true)}
          disabled={workflowStatus.state === 'running'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-blue to-neon-purple rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          title="AI 生成工作流"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI 生成
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
          <div className="flex items-center gap-1">
            <button
              onClick={handleExecuteWorkflow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
            >
              <Play className="w-3.5 h-3.5" />
              执行工作流
            </button>
            {hasRetryableNodes && (
              <button
                onClick={handleResumeWorkflow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-canvas-hover border border-canvas-border rounded-md hover:border-neon-purple hover:text-white transition-colors"
                title="跳过已完成节点，仅执行失败/未执行的节点"
              >
                <RotateCw className="w-3.5 h-3.5" />
                断点续执行
              </button>
            )}
          </div>
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
                  void discardRecovery();
                  setShowRecoveryDialog(false);
                }}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                丢弃
              </button>
              <button
                onClick={async () => {
                  const snapshot = await checkRecovery();
                  if (snapshot) await restoreSnapshot(snapshot);
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
      {/* AI 生成模态框 */}
      <AiGenerateModal
        open={showAiModal}
        onClose={() => setShowAiModal(false)}
        onGenerated={handleAiGenerated}
      />
      {/* 快捷键帮助面板 */}
      <ShortcutHelpModal
        open={showShortcutHelp}
        onClose={() => setShowShortcutHelp(false)}
      />
    </div>
  );
}
