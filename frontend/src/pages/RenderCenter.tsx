import { Monitor, Download, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// 模拟渲染任务
const MOCK_TASKS = [
  { id: '1', project: 'AI 短片 - 城市夜景', status: 'completed' as const, progress: 100, format: 'mp4', date: '2024-01-15 14:30', size: '128.5 MB' },
  { id: '2', project: '角色动画测试', status: 'rendering' as const, progress: 67, format: 'mp4', date: '2024-01-15 15:20', size: '-' },
  { id: '3', project: 'BGM 混音导出', status: 'queued' as const, progress: 0, format: 'mp3', date: '2024-01-15 15:45', size: '-' },
  { id: '4', project: '文生图批量输出', status: 'failed' as const, progress: 45, format: 'png', date: '2024-01-14 10:00', size: '-' },
];

const STATUS_CONFIG = {
  queued: { icon: Clock, label: '排队中', color: 'text-slate-400', bg: 'bg-slate-400/10' },
  rendering: { icon: Loader2, label: '渲染中', color: 'text-neon-purple', bg: 'bg-neon-purple/10' },
  completed: { icon: CheckCircle2, label: '已完成', color: 'text-status-success', bg: 'bg-status-success/10' },
  failed: { icon: XCircle, label: '失败', color: 'text-status-error', bg: 'bg-status-error/10' },
};

export default function RenderCenter() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-center gap-3 mb-6">
          <Monitor className="w-6 h-6 text-neon-purple" />
          <h1 className="text-2xl font-bold text-white font-display">渲染中心</h1>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {(['queued', 'rendering', 'completed', 'failed'] as const).map((status) => {
            const config = STATUS_CONFIG[status];
            const count = MOCK_TASKS.filter((t) => t.status === status).length;
            const Icon = config.icon;
            return (
              <div key={status} className="rounded-xl border border-canvas-border bg-canvas-panel p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}>
                    <Icon className={`w-4 h-4 ${config.color} ${status === 'rendering' ? 'animate-spin' : ''}`} />
                  </div>
                  <span className="text-xs text-slate-500">{config.label}</span>
                </div>
                <span className="text-2xl font-bold text-white font-display">{count}</span>
              </div>
            );
          })}
        </div>

        {/* 任务列表 */}
        <div className="border border-canvas-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-canvas-panel text-xs text-slate-500">
                <th className="text-left px-4 py-3 font-medium">项目</th>
                <th className="text-left px-4 py-3 font-medium">状态</th>
                <th className="text-left px-4 py-3 font-medium">进度</th>
                <th className="text-left px-4 py-3 font-medium">格式</th>
                <th className="text-left px-4 py-3 font-medium">时间</th>
                <th className="text-left px-4 py-3 font-medium">大小</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TASKS.map((task) => {
                const config = STATUS_CONFIG[task.status];
                const Icon = config.icon;
                return (
                  <tr key={task.id} className="border-t border-canvas-border hover:bg-canvas-hover/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-200">{task.project}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`w-3.5 h-3.5 ${config.color} ${task.status === 'rendering' ? 'animate-spin' : ''}`} />
                        <span className={`text-xs ${config.color}`}>{config.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-canvas-border rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              task.status === 'completed' ? 'bg-status-success' :
                              task.status === 'failed' ? 'bg-status-error' :
                              'bg-gradient-to-r from-neon-purple to-neon-blue'
                            }`}
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{task.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 uppercase">{task.format}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{task.date}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{task.size}</td>
                    <td className="px-4 py-3 text-right">
                      {task.status === 'completed' && (
                        <button className="flex items-center gap-1 px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10 rounded transition-colors ml-auto">
                          <Download className="w-3.5 h-3.5" />
                          下载
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
