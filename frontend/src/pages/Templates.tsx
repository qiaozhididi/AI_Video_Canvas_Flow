import { Search, Download, Tag } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';
import { templateApi, type TemplateResponse } from '../utils/apiClient';

const CATEGORIES = ['全部', '官方'] as const;

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('全部');
  const [cloningId, setCloningId] = useState<string | null>(null);

  const fetchTemplates = useCallback((q: string, cat: string) => {
    setLoading(true);
    const params: { q?: string; category?: string } = {};
    if (q) params.q = q;
    if (cat !== '全部') params.category = cat;
    templateApi.list(params)
      .then(setTemplates)
      .catch((err: unknown) => {
        const msg = getErrorMessage(err, 'template_load');
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  // 初始加载
  useEffect(() => {
    fetchTemplates('', '全部');
  }, [fetchTemplates]);

  // 搜索 debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTemplates(search, category);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, category, fetchTemplates]);

  const handleClone = async (template: TemplateResponse) => {
    setCloningId(template.id);
    try {
      const project = await templateApi.clone(template.id);
      toast.success(`已从模板创建项目「${project.name}」`);
      navigate(`/editor/${project.id}`);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'template_clone');
      toast.error(msg);
    } finally {
      setCloningId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-white font-display mb-2">模板市场</h1>
        <p className="text-slate-400 text-sm mb-6">浏览并导入工作流模板，快速开始创作</p>

        {/* 搜索 + 分类筛选 */}
        <div className="flex items-center gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="搜索模板名称或标签..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
            />
          </div>
          <div className="flex items-center gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  category === cat
                    ? 'bg-neon-purple/20 text-neon-purple'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-canvas-hover'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 模板网格 */}
        {loading ? (
          <p className="text-sm text-slate-500 text-center py-20">加载中...</p>
        ) : templates.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-panel flex items-center justify-center mb-4">
              <Tag className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-slate-400 mb-2">暂无模板</p>
            <p className="text-sm text-slate-600">尝试更换搜索关键词或分类</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
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
                    {template.template_category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas-hover text-slate-400">
                        {template.template_category}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mb-3 line-clamp-2">
                    {template.description || '暂无描述'}
                  </p>

                  {/* 标签 */}
                  {template.template_tags && template.template_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {template.template_tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 操作 */}
                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => handleClone(template)}
                      disabled={cloningId === template.id}
                      className="px-3 py-1 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cloningId === template.id ? '导入中...' : '导入'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
