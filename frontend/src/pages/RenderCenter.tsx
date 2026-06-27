import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Monitor, Download, Clock, CheckCircle2, XCircle, Loader2, Plus, Pause, AlertCircle } from 'lucide-react';
import { renderApi, projectApi } from '@/utils/apiClient';
import type { RenderTaskResponse, ProjectResponse } from '@/utils/apiClient';
import { toast } from 'sonner';

// ── 状态配置 ──

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending: { label: '排队中', color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: Clock },
  running: { label: '渲染中', color: 'text-blue-400', bg: 'bg-blue-400/10', icon: Loader2 },
  completed: { label: '已完成', color: 'text-green-400', bg: 'bg-green-400/10', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-400', bg: 'bg-red-400/10', icon: XCircle },
  cancelled: { label: '已取消', color: 'text-slate-400', bg: 'bg-slate-400/10', icon: AlertCircle },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
}

// ── 任务类型 ──

const TASK_TYPES = [
  { value: 'video_render', label: '视频渲染' },
  { value: 'image_render', label: '图片渲染' },
  { value: 'audio_render', label: '音频渲染' },
];

// ── 格式化 ──

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// ── 统计卡片渐变 ──

const STAT_GRADIENTS: Record<string, string> = {
  pending: 'from-yellow-500/20 to-yellow-600/5',
  running: 'from-blue-500/20 to-blue-600/5',
  completed: 'from-green-500/20 to-green-600/5',
  failed: 'from-red-500/20 to-red-600/5',
};

export default function RenderCenter() {
  const [tasks, setTasks] = useState<RenderTaskResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTaskType, setSelectedTaskType] = useState('video_render');
  const [creating, setCreating] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    try {
      const data = await renderApi.list();
      setTasks(data);
    } catch {
      // 轮询静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    pollingRef.current = setInterval(loadTasks, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loadTasks]);

  // 统计
  const stats = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'pending').length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  }), [tasks]);

  // 按 created_at DESC 排序
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [tasks],
  );

  // 取消任务
  const handleCancel = async (id: string) => {
    try {
      await renderApi.cancel(id);
      toast.success('任务已取消');
      await loadTasks();
    } catch {
      toast.error('取消失败');
    }
  };

  // 下载结果
  const handleDownload = async (task: RenderTaskResponse) => {
    if (!task.result_url) return;
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/v1/media/${task.result_url}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `render-${task.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('下载失败');
    }
  };

  // 打开创建对话框
  const openCreateDialog = async () => {
    setShowCreate(true);
    try {
      const data = await projectApi.list();
      setProjects(data);
      if (data.length > 0 && !selectedProject) {
        setSelectedProject(data[0].id);
      }
    } catch {
      toast.error('加载项目列表失败');
    }
  };

  // 创建任务
  const handleCreate = async () => {
    if (!selectedProject) {
      toast.error('请选择项目');
      return;
    }
    try {
      setCreating(true);
      await renderApi.create({ project_id: selectedProject, task_type: selectedTaskType });
      toast.success('渲染任务已创建');
      setShowCreate(false);
      await loadTasks();
    } catch {
      toast.error('创建任务失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Monitor className="w-6 h-6 text-neon-purple" />
            <h1 className="text-2xl font-bold text-white font-display">渲染中心</h1>
          </div>
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:shadow-[0_0_16px_rgba(124,58,237,0.5)] hover:scale-105 active:scale-95 transition-all duration-200"
          >
            <Plus className="w-3.5 h-3.5" />
            创建任务
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {(['pending', 'running', 'completed', 'failed'] as const).map((status) => {
            const config = STATUS_CONFIG[status];
            const count = stats[status];
            const Icon = config.icon;
            return (
              <div
                key={status}
                className={`rounded-xl border border-canvas-border bg-gradient-to-br ${STAT_GRADIENTS[status]} to-transparent p-4`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}>
                    <Icon className={`w-4 h-4 ${config.color} ${status === 'running' ? 'animate-spin' : ''}`} />
                  </div>
                  <span className="text-xs text-slate-500">{config.label}</span>
                </div>
                <span className="text-2xl font-bold text-white font-display">{count}</span>
              </div>
            );
          })}
        </div>

        {/* 加载状态 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
          </div>
        ) : sortedTasks.length === 0 ? (
          /* 空状态 */
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-panel flex items-center justify-center mb-4">
              <Monitor className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-slate-400 mb-2">暂无渲染任务</p>
            <p className="text-sm text-slate-600">点击"创建任务"开始渲染</p>
          </div>
        ) : (
          /* 任务列表 */
          <div className="border border-canvas-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-canvas-panel text-xs text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">任务 ID</th>
                  <th className="text-left px-4 py-3 font-medium">类型</th>
                  <th className="text-left px-4 py-3 font-medium">状态</th>
                  <th className="text-left px-4 py-3 font-medium">进度</th>
                  <th className="text-left px-4 py-3 font-medium">创建时间</th>
                  <th className="text-left px-4 py-3 font-medium">错误信息</th>
                  <th className="text-right px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => {
                  const config = getStatusConfig(task.status);
                  const Icon = config.icon;
                  return (
                    <tr key={task.id} className="border-t border-canvas-border hover:bg-canvas-hover/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-200 font-mono">{task.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{task.task_type}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${config.color} ${task.status === 'running' ? 'animate-spin' : ''}`} />
                          <span className={`text-xs ${config.color}`}>{config.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-canvas-border rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                task.status === 'completed' ? 'bg-green-400' :
                                task.status === 'failed' ? 'bg-red-400' :
                                'bg-gradient-to-r from-neon-purple to-neon-blue'
                              }`}
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">{task.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDate(task.created_at)}</td>
                      <td className="px-4 py-3 text-xs text-red-400 max-w-[200px] truncate">{task.error_message ?? '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(task.status === 'pending' || task.status === 'running') && (
                            <button
                              onClick={() => handleCancel(task.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              取消
                            </button>
                          )}
                          {task.status === 'completed' && (
                            <button
                              onClick={() => handleDownload(task)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10 rounded transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" />
                              下载
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 创建任务对话框 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div
            className="w-full max-w-md rounded-xl border border-canvas-border bg-canvas-panel p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white font-display mb-4">创建渲染任务</h2>

            <div className="space-y-4">
              {/* 选择项目 */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">选择项目</label>
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-canvas-hover border border-canvas-border rounded-lg text-slate-200 focus:outline-none focus:border-neon-purple"
                >
                  <option value="">请选择项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* 任务类型 */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">任务类型</label>
                <select
                  value={selectedTaskType}
                  onChange={(e) => setSelectedTaskType(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-canvas-hover border border-canvas-border rounded-lg text-slate-200 focus:outline-none focus:border-neon-purple"
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !selectedProject}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:shadow-[0_0_16px_rgba(124,58,237,0.5)] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
