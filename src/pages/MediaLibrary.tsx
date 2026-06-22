import { useState } from 'react';
import { Upload, Search, Grid3X3, List, Image, Film, Music, Trash2, Download } from 'lucide-react';

type AssetType = 'all' | 'image' | 'video' | 'audio';
type ViewMode = 'grid' | 'list';

// 模拟数据
const MOCK_ASSETS = [
  { id: '1', name: 'scene_01.png', type: 'image' as const, size: '2.4 MB', date: '2024-01-15' },
  { id: '2', name: 'character_ref.jpg', type: 'image' as const, size: '1.8 MB', date: '2024-01-14' },
  { id: '3', name: 'clip_01.mp4', type: 'video' as const, size: '45.2 MB', date: '2024-01-13' },
  { id: '4', name: 'narration.mp3', type: 'audio' as const, size: '3.1 MB', date: '2024-01-12' },
  { id: '5', name: 'bgm_ambient.wav', type: 'audio' as const, size: '8.7 MB', date: '2024-01-11' },
  { id: '6', name: 'output_final.mp4', type: 'video' as const, size: '128.5 MB', date: '2024-01-10' },
];

export default function MediaLibrary() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssetType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const filtered = MOCK_ASSETS.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase());
    const matchType = filter === 'all' || a.type === filter;
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
    <div className="h-full overflow-y-auto">
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

          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity">
            <Upload className="w-3.5 h-3.5" />
            上传素材
          </button>
        </div>

        {/* 素材列表 */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((asset) => {
              const Icon = TYPE_ICONS[asset.type];
              return (
                <div key={asset.id} className="group rounded-xl border border-canvas-border bg-canvas-panel overflow-hidden hover:border-canvas-hover transition-all">
                  <div className="aspect-square bg-canvas-hover flex items-center justify-center relative">
                    <Icon className={`w-10 h-10 ${TYPE_COLORS[asset.type]}`} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                      <button className="p-1.5 rounded-full bg-white/20 hover:bg-white/30">
                        <Download className="w-4 h-4 text-white" />
                      </button>
                      <button className="p-1.5 rounded-full bg-white/20 hover:bg-white/30">
                        <Trash2 className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-slate-300 truncate">{asset.name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{asset.size}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
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
                  const Icon = TYPE_ICONS[asset.type];
                  return (
                    <tr key={asset.id} className="border-t border-canvas-border hover:bg-canvas-hover/50 transition-colors">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${TYPE_COLORS[asset.type]}`} />
                          <span className="text-sm text-slate-300">{asset.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-400 capitalize">{asset.type}</td>
                      <td className="px-4 py-2 text-xs text-slate-400">{asset.size}</td>
                      <td className="px-4 py-2 text-xs text-slate-400">{asset.date}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button className="p-1 rounded hover:bg-canvas-hover">
                            <Download className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                          <button className="p-1 rounded hover:bg-canvas-hover">
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
