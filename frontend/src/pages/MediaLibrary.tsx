import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Search, Grid3X3, List, Image, Film, Music, Trash2, Download, Loader2, ImageIcon } from 'lucide-react';
import { mediaApi } from '@/utils/apiClient';
import type { MediaAssetResponse } from '@/utils/apiClient';
import { toast } from 'sonner';

type AssetType = 'all' | 'image' | 'video' | 'audio';
type ViewMode = 'grid' | 'list';

/** 从 MIME 类型提取资源分类 */
function toAssetCategory(fileType: string): 'image' | 'video' | 'audio' {
  if (fileType.startsWith('image/')) return 'image';
  if (fileType.startsWith('video/')) return 'video';
  return 'audio';
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 格式化日期 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN');
}

/** 图片缩略图：懒加载 + presigned URL + 降级占位 */
function AssetThumbnail({ assetId, alt, className, fallbackIcon }: {
  assetId: string;
  alt: string;
  className?: string;
  fallbackIcon?: React.ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // IntersectionObserver 懒加载
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 可见时才请求 presigned URL
  useEffect(() => {
    if (!visible) return;
    let revoked = false;
    mediaApi.getPresignedUrl(assetId).then(({ url }) => {
      if (!revoked) setSrc(url);
    }).catch(() => setError(true));
    return () => { revoked = true; };
  }, [visible, assetId]);

  // 加载失败降级
  if (error || (visible && !src)) {
    return (
      <div ref={ref} className={`flex items-center justify-center bg-canvas-hover ${className ?? ''}`}>
        {fallbackIcon ?? <ImageIcon className="w-6 h-6 text-slate-600" />}
      </div>
    );
  }

  // 未进入视口：占位
  if (!visible) {
    return <div ref={ref} className={`bg-canvas-hover ${className ?? ''}`} />;
  }

  // 正在加载 presigned URL
  if (!src) {
    return (
      <div ref={ref} className={`flex items-center justify-center bg-canvas-hover ${className ?? ''}`}>
        <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
    />
  );
}

export default function MediaLibrary() {
  const [assets, setAssets] = useState<MediaAssetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssetType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await mediaApi.list();
      setAssets(data);
    } catch {
      toast.error('加载素材列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const uploadFile = async (file: File) => {
    try {
      setUploading(true);
      await mediaApi.upload(file);
      toast.success('上传成功');
      await loadAssets();
    } catch (err) {
      console.error('[Media:Upload] 上传失败', err);
      toast.error('上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      toast.error('仅支持图片、视频、音频文件');
      return;
    }
    await uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDelete = async (id: string, fileName: string) => {
    if (!window.confirm(`确定要删除「${fileName}」吗？此操作不可恢复。`)) return;
    try {
      await mediaApi.delete(id);
      toast.success('删除成功');
      await loadAssets();
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        toast.info('素材已不存在，列表已刷新');
        await loadAssets();
      } else {
        toast.error('删除失败');
      }
    }
  };

  const handleDownload = async (id: string, fileName: string) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/v1/media/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('下载失败');
    }
  };

  const filtered = assets.filter((a) => {
    const category = toAssetCategory(a.file_type);
    const matchSearch = a.file_name.toLowerCase().includes(search.toLowerCase());
    const matchType = filter === 'all' || category === filter;
    return matchSearch && matchType;
  });

  const TYPE_ICONS = {
    image: Image,
    video: Film,
    audio: Music,
  };

  const TYPE_COLORS = {
    image: 'text-neon-purple',
    video: 'text-neon-blue',
    audio: 'text-neon-cyan',
  };

  return (
    <div
      className="h-full overflow-y-auto"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-white font-display mb-6">媒体库</h1>

        {/* 工具栏 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="搜索素材..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
            />
          </div>

          <div className="flex items-center bg-canvas-panel border border-canvas-border rounded-lg overflow-hidden">
            {(['all', 'image', 'video', 'audio'] as AssetType[]).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  filter === type ? 'bg-neon-purple/20 text-neon-purple' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {type === 'all' ? '全部' : type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}
              </button>
            ))}
          </div>

          <div className="flex items-center bg-canvas-panel border border-canvas-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 ${viewMode === 'grid' ? 'text-neon-purple' : 'text-slate-400'}`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 ${viewMode === 'list' ? 'text-neon-purple' : 'text-slate-400'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <div className="relative group">
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              onChange={handleFileChange}
              disabled={uploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg pointer-events-none transition-all duration-200 group-hover:shadow-[0_0_16px_rgba(124,58,237,0.5)] group-hover:scale-105 group-active:scale-95">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? '上传中...' : '上传素材'}
            </div>
          </div>
        </div>

        {/* 拖拽上传提示 */}
        {dragOver && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
            <div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-neon-purple bg-canvas-panel/90">
              <Upload className="w-10 h-10 text-neon-purple" />
              <p className="text-lg font-medium text-white">释放文件以上传</p>
            </div>
          </div>
        )}

        {/* 加载状态 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-panel flex items-center justify-center mb-4">
              <Image className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-slate-400 mb-2">{assets.length === 0 ? '暂无素材' : '没有匹配的素材'}</p>
            <p className="text-sm text-slate-600">点击"上传素材"或拖拽文件到此处</p>
          </div>
        ) : viewMode === 'grid' ? (
          /* 网格视图 */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((asset) => {
              const category = toAssetCategory(asset.file_type);
              const Icon = TYPE_ICONS[category];
              return (
                <div key={asset.id} className="group rounded-xl border border-canvas-border bg-canvas-panel overflow-hidden hover:border-canvas-hover transition-all">
                  <div className="aspect-square bg-canvas-hover flex items-center justify-center relative overflow-hidden">
                    {category === 'image' ? (
                      <AssetThumbnail
                        assetId={asset.id}
                        alt={asset.file_name}
                        className="w-full h-full object-cover"
                        fallbackIcon={<Icon className={`w-10 h-10 ${TYPE_COLORS[category]}`} />}
                      />
                    ) : (
                      <Icon className={`w-10 h-10 ${TYPE_COLORS[category]}`} />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => handleDownload(asset.id, asset.file_name)}
                        className="p-1.5 rounded-full bg-white/20 hover:bg-white/30"
                      >
                        <Download className="w-4 h-4 text-white" />
                      </button>
                      <button
                        onClick={() => handleDelete(asset.id, asset.file_name)}
                        className="p-1.5 rounded-full bg-white/20 hover:bg-white/30"
                      >
                        <Trash2 className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-slate-300 truncate">{asset.file_name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{formatSize(asset.file_size)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* 列表视图 */
          <div className="border border-canvas-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-canvas-panel text-xs text-slate-500">
                  <th className="text-left px-4 py-2 font-medium">名称</th>
                  <th className="text-left px-4 py-2 font-medium">类型</th>
                  <th className="text-left px-4 py-2 font-medium">大小</th>
                  <th className="text-left px-4 py-2 font-medium">日期</th>
                  <th className="text-right px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => {
                  const category = toAssetCategory(asset.file_type);
                  const Icon = TYPE_ICONS[category];
                  return (
                    <tr key={asset.id} className="border-t border-canvas-border hover:bg-canvas-hover/50 transition-colors">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {category === 'image' ? (
                            <AssetThumbnail
                              assetId={asset.id}
                              alt={asset.file_name}
                              className="w-8 h-8 rounded object-cover shrink-0"
                            />
                          ) : (
                            <Icon className={`w-4 h-4 shrink-0 ${TYPE_COLORS[category]}`} />
                          )}
                          <span className="text-sm text-slate-300">{asset.file_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400 capitalize">{category}</td>
                      <td className="px-4 py-2 text-xs text-slate-400">{formatSize(asset.file_size)}</td>
                      <td className="px-4 py-2 text-xs text-slate-400">{formatDate(asset.created_at)}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDownload(asset.id, asset.file_name)}
                            className="p-1 rounded hover:bg-canvas-hover"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                          <button
                            onClick={() => handleDelete(asset.id, asset.file_name)}
                            className="p-1 rounded hover:bg-canvas-hover"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-status-error" />
                          </button>
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
    </div>
  );
}
