// 存储用量标签页
// 从原 Settings.tsx StorageTab（第 979-1064 行）迁移
// 改造为受控组件：stats / usage / loading 由父容器传入，本组件不再直接调用 API
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { StorageStatsResponse, StorageUsageResponse } from '@/utils/apiClient';

interface StorageSectionProps {
  stats: StorageStatsResponse | null;
  usage: StorageUsageResponse | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

// 字节格式化（仅本组件使用）
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  image: { label: '图片', color: 'text-purple-400' },
  video: { label: '视频', color: 'text-emerald-400' },
  audio: { label: '音频', color: 'text-amber-400' },
  application: { label: '文档', color: 'text-blue-400' },
};

export function StorageSection({ stats, usage, loading, onRefresh }: StorageSectionProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }

  const quotaBytes = stats?.quota_bytes ?? 10 * 1024 * 1024 * 1024;
  const usedBytes = stats?.used_bytes ?? 0;
  const categories = usage?.categories ?? {};
  const usagePercent = Math.min((usedBytes / quotaBytes) * 100, 100);

  // 4 阶段进度条颜色：0-50% 绿色 / 50-75% 黄色 / 75-90% 橙色 / >90% 红色
  const getBarColor = (pct: number) => {
    if (pct > 90) return 'bg-red-500';
    if (pct > 75) return 'bg-orange-500';
    if (pct > 50) return 'bg-yellow-500';
    return 'bg-gradient-to-r from-neon-purple to-neon-blue';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-white font-display">存储用量</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="刷新存储统计"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 border border-canvas-border rounded-lg hover:bg-canvas-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="rounded-xl border border-canvas-border bg-canvas-panel p-4 space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-300">已使用</span>
            <span className="text-slate-400">{formatBytes(usedBytes)} / {formatBytes(quotaBytes)}</span>
          </div>
          <div className="w-full h-2 bg-canvas-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarColor(usagePercent)}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-600 mt-1">
            <span>0%</span><span>50%</span><span>75%</span><span>90%</span><span>100%</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {Object.entries(categories).map(([cat, data]) => {
            const meta = CATEGORY_META[cat] ?? { label: cat, color: 'text-slate-400' };
            return (
              <div key={cat} className="p-3 bg-canvas-bg rounded-lg">
                <p className={`text-lg font-bold font-display ${meta.color}`}>{data.count}</p>
                <p className="text-xs text-slate-500">{meta.label}</p>
                <p className="text-xs text-slate-600 mt-0.5">{formatBytes(data.size)}</p>
              </div>
            );
          })}
          {Object.keys(categories).length === 0 && (
            <div className="col-span-3 p-3 bg-canvas-bg rounded-lg">
              <p className="text-sm text-slate-500">暂无存储数据</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
