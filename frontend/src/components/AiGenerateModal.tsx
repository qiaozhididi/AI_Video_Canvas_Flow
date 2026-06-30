import { useState } from 'react';
import { X, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { aiApi, type NodeCreateRequest, type EdgeCreateRequest } from '@/utils/apiClient';
import { toast } from 'sonner';

interface AiGenerateModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (nodes: NodeCreateRequest[], edges: EdgeCreateRequest[], mode: 'replace' | 'append') => void;
}

export default function AiGenerateModal({ open, onClose, onGenerated }: AiGenerateModalProps) {
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('append');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError('请输入工作流描述');
      return;
    }

    // 替换模式二次确认
    if (mode === 'replace') {
      const confirmed = window.confirm('替换模式将清空当前画布的所有节点和边,确定继续吗?');
      if (!confirmed) return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await aiApi.generateWorkflow({ description: description.trim(), mode });
      onGenerated(result.nodes, result.edges, mode);
      toast.success(`已生成 ${result.nodes.length} 个节点`);
      // 重置并关闭
      setDescription('');
      setError(null);
      onClose();
    } catch (err: any) {
      const msg = err?.message || '生成失败,请重试';
      setError(msg);
      // 不关闭模态框,保留输入内容便于重试
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter 提交
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[480px] shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-medium text-white font-display">AI 生成工作流</h3>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded hover:bg-canvas-hover text-slate-400 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5 space-y-4">
          {/* 描述输入 */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">工作流描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              autoFocus
              disabled={loading}
              placeholder='描述你想要的工作流,如"生成产品宣传视频:文本输入 → 文生图 → 图生视频 → 视频输出"'
              className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-neon-purple resize-none disabled:opacity-50"
            />
            <p className="text-[10px] text-slate-600">Ctrl/⌘ + Enter 快速生成</p>
          </div>

          {/* 模式选择 */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">生成模式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('append')}
                disabled={loading}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                  mode === 'append'
                    ? 'bg-neon-purple/20 border-neon-purple text-slate-200'
                    : 'bg-canvas-bg border-canvas-border text-slate-400 hover:border-canvas-hover'
                } disabled:opacity-50`}
              >
                追加到画布
                <span className="block text-[10px] text-slate-500 mt-0.5">保留现有节点</span>
              </button>
              <button
                onClick={() => setMode('replace')}
                disabled={loading}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                  mode === 'replace'
                    ? 'bg-red-500/20 border-red-500 text-slate-200'
                    : 'bg-canvas-bg border-canvas-border text-slate-400 hover:border-canvas-hover'
                } disabled:opacity-50`}
              >
                替换当前画布
                <span className="block text-[10px] text-slate-500 mt-0.5">清空后加载</span>
              </button>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-canvas-border">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !description.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                生成
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
