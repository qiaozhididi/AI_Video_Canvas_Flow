import { useState, useEffect, useRef } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { renderApi } from '@/utils/apiClient';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';

interface ExportModalProps {
  projectId: string;
  onClose: () => void;
}

const FORMATS = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM' },
];

const RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
];

type ExportStage = 'idle' | 'exporting' | 'completed' | 'failed';

export default function ExportModal({ projectId, onClose }: ExportModalProps) {
  const [format, setFormat] = useState('mp4');
  const [resolution, setResolution] = useState('1080p');
  const [stage, setStage] = useState<ExportStage>('idle');
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleExport = async () => {
    setStage('exporting');
    setProgress(0);
    setResultUrl(null);

    try {
      const res = await renderApi.exportVideo(projectId, format, resolution);
      const taskId = res.task_id;

      // 开始轮询
      pollingRef.current = setInterval(async () => {
        try {
          const task = await renderApi.get(taskId);
          setProgress(task.progress);

          if (task.status === 'completed') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStage('completed');
            setResultUrl(task.result_url);
            toast.success('视频导出完成');
          } else if (task.status === 'failed') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStage('failed');
            toast.error(task.error_message || '导出失败');
          }
        } catch {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStage('failed');
          toast.error('查询进度失败');
        }
      }, 2000);
    } catch (err: any) {
      setStage('failed');
      toast.error(getErrorMessage(err, 'render_export'));
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.target = '_blank';
    a.download = `export.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleClose = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && stage !== 'exporting') handleClose();
      }}
    >
      <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[420px] shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-medium text-white font-display">导出视频</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={stage === 'exporting'}
            className="p-1 rounded hover:bg-canvas-hover text-slate-400 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5 space-y-4">
          {stage === 'idle' && (
            <>
              {/* 格式选择 */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 uppercase tracking-wider">格式</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 focus:outline-none focus:border-neon-purple"
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* 分辨率选择 */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 uppercase tracking-wider">分辨率</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 focus:outline-none focus:border-neon-purple"
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {stage === 'exporting' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-neon-purple animate-spin" />
                <span className="text-sm text-slate-300">正在导出视频...</span>
              </div>
              <div className="w-full h-2 bg-canvas-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-neon-purple to-neon-blue rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 text-center">{progress}%</p>
            </div>
          )}

          {stage === 'completed' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-400">
                <Download className="w-4 h-4" />
                <span className="text-sm">导出完成</span>
              </div>
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
              >
                <Download className="w-3.5 h-3.5" />
                下载视频
              </button>
            </div>
          )}

          {stage === 'failed' && (
            <div className="space-y-3">
              <p className="text-sm text-red-400">导出失败，请重试</p>
              <button
                onClick={() => { setStage('idle'); setProgress(0); }}
                className="w-full px-4 py-2 text-sm text-slate-300 bg-canvas-hover border border-canvas-border rounded-md hover:bg-canvas-border transition-colors"
              >
                重新选择
              </button>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-canvas-border">
          <button
            onClick={handleClose}
            disabled={stage === 'exporting'}
            className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50"
          >
            取消
          </button>
          {stage === 'idle' && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
            >
              <Download className="w-3.5 h-3.5" />
              开始导出
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
