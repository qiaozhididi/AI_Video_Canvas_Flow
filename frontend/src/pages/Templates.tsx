import { Search, Download, Star, Users } from 'lucide-react';
import { useState } from 'react';

const MOCK_TEMPLATES = [
  { id: '1', name: '文生图 → 图生视频', description: '从文本描述生成图片，再转为视频片段', author: '官方', tags: ['文生图', '图生视频'], stars: 128, uses: 1024 },
  { id: '2', name: '角色配音工作流', description: '文本转语音 + 视频合成', author: '社区', tags: ['TTS', '视频合成'], stars: 86, uses: 534 },
  { id: '3', name: '批量图片风格化', description: '一键将多张图片转为指定风格', author: '官方', tags: ['风格化', '批量处理'], stars: 215, uses: 1890 },
  { id: '4', name: '短视频全流程', description: '文生图 → 图生视频 → 配音 → 合成', author: '官方', tags: ['全流程', '短视频'], stars: 342, uses: 2567 },
  { id: '5', name: '图片高清放大', description: '将低分辨率图片放大至 4K', author: '社区', tags: ['高清', '放大'], stars: 67, uses: 423 },
  { id: '6', name: 'BGM 自动生成', description: '根据视频内容自动匹配背景音乐', author: '社区', tags: ['音频', 'BGM'], stars: 93, uses: 678 },
];

export default function Templates() {
  const [search, setSearch] = useState('');

  const filtered = MOCK_TEMPLATES.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.tags.some((tag) => tag.includes(search))
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-white font-display mb-2">模板市场</h1>
        <p className="text-slate-400 text-sm mb-6">浏览并导入工作流模板，快速开始创作</p>

        {/* 搜索 */}
        <div className="relative max-w-md mb-8">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="搜索模板或标签..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
          />
        </div>

        {/* 模板网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((template) => (
            <div
              key={template.id}
              className="group rounded-xl border border-canvas-border bg-canvas-panel overflow-hidden hover:border-neon-purple/30 transition-all"
            >
              {/* 预览图占位 */}
              <div className="aspect-[16/9] bg-gradient-to-br from-neon-purple/20 to-neon-blue/10 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-canvas-hover/50 flex items-center justify-center mb-2">
                    <Download className="w-6 h-6 text-neon-purple" />
                  </div>
                  <p className="text-xs text-slate-500">{template.name}</p>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-white font-display">{template.name}</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas-hover text-slate-400">
                    {template.author}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-3 line-clamp-2">{template.description}</p>

                {/* 标签 */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* 统计与操作 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {template.stars}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {template.uses}
                    </span>
                  </div>
                  <button className="px-3 py-1 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity">
                    导入
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
