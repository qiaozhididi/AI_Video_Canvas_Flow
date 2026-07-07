import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import {
  Plus, Search, Clock, Trash2, Film, Sparkles,
  ArrowRight, Share2, X,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { templateApi, aiApi, workflowApi, type TemplateResponse, type AiModelResponse } from '../utils/apiClient';

export default function Home() {
  const { projects, createProject, deleteProject, loadProjects } = useProjectStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [publishModal, setPublishModal] = useState<{ open: boolean; projectId: string; projectName: string }>({ open: false, projectId: '', projectName: '' });
  const [publishCategory, setPublishCategory] = useState('官方');
  const [publishTags, setPublishTags] = useState('');
  const [publishing, setPublishing] = useState(false);

  // 从模板创建弹窗
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<string>('全部');
  const [templateList, setTemplateList] = useState<TemplateResponse[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);

  // AI 快速生成弹窗
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiModelId, setAiModelId] = useState('');
  const [aiLlmModels, setAiLlmModels] = useState<AiModelResponse[]>([]);
  const [aiGenerating, setAiGenerating] = useState(false);

  // 首次加载时从后端获取项目列表
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 加载模板列表
  useEffect(() => {
    if (!showTemplateDialog) return;
    setTemplateLoading(true);
    const params: { q?: string; category?: string } = {};
    if (templateSearch.trim()) params.q = templateSearch.trim();
    if (templateCategory !== '全部') params.category = templateCategory;
    templateApi.list(params)
      .then(setTemplateList)
      .catch(() => toast.error('加载模板列表失败'))
      .finally(() => setTemplateLoading(false));
  }, [showTemplateDialog, templateSearch, templateCategory]);

  // 加载 LLM 模型列表
  useEffect(() => {
    if (!showAIDialog) return;
    aiApi.models.list({ model_type: 'llm' })
      .then((models) => {
        setAiLlmModels(models);
        if (models.length > 0 && !aiModelId) {
          setAiModelId(models[0].id);
        }
      })
      .catch(() => toast.error('加载模型列表失败'));
  }, [showAIDialog]);

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    const name = newProjectName.trim() || `项目 ${projects.length + 1}`;
    const project = await createProject(name);
    setShowNewDialog(false);
    setNewProjectName('');
    navigate(`/editor/${project.id}`);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const tags = publishTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await templateApi.publish(publishModal.projectId, { category: publishCategory, tags });
      toast.success(`项目「${publishModal.projectName}」已发布为模板`);
      setPublishModal({ open: false, projectId: '', projectName: '' });
      setPublishTags('');
      setPublishCategory('官方');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发布失败';
      toast.error(msg);
    } finally {
      setPublishing(false);
    }
  };

  const handleCloneTemplate = async (template: TemplateResponse) => {
    setCloningId(template.id);
    try {
      const project = await templateApi.clone(template.id);
      toast.success(`已从模板「${template.name}」创建项目`);
      setShowTemplateDialog(false);
      navigate(`/editor/${project.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '克隆模板失败';
      toast.error(msg);
    } finally {
      setCloningId(null);
    }
  };

  const handleAIGenerate = async () => {
    if (!aiDescription.trim()) {
      toast.error('请输入工作流描述');
      return;
    }
    setAiGenerating(true);
    try {
      const project = await createProject('AI 生成的工作流');
      const workflow = await aiApi.generateWorkflow({
        description: aiDescription.trim(),
        mode: 'replace',
        model_id: aiModelId || undefined,
      });
      await workflowApi.save(project.id, workflow);
      toast.success('AI 工作流生成成功');
      setShowAIDialog(false);
      setAiDescription('');
      navigate(`/editor/${project.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI 生成失败';
      toast.error(msg);
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Hero 区域 */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-3xl font-bold font-display text-white">
              AI Canvas Flow
            </h1>
          </div>
          <p className="text-slate-400 ml-[52px]">
            可视化 AI 视频创作工作流平台
          </p>
        </div>

        {/* 快捷操作 */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <button
            onClick={() => setShowNewDialog(true)}
            className="group relative overflow-hidden rounded-xl border border-canvas-border bg-canvas-panel p-6 text-left hover:border-neon-purple/50 transition-all"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-neon-purple/20 flex items-center justify-center mb-3">
                <Plus className="w-5 h-5 text-neon-purple" />
              </div>
              <h3 className="text-sm font-medium text-white font-display">新建工作流</h3>
              <p className="text-xs text-slate-500 mt-1">从空白画布开始创作</p>
            </div>
          </button>

          <button onClick={() => setShowTemplateDialog(true)} className="group relative overflow-hidden rounded-xl border border-canvas-border bg-canvas-panel p-6 text-left hover:border-neon-blue/50 transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-blue/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-neon-blue/20 flex items-center justify-center mb-3">
                <Film className="w-5 h-5 text-neon-blue" />
              </div>
              <h3 className="text-sm font-medium text-white font-display">从模板创建</h3>
              <p className="text-xs text-slate-500 mt-1">使用预设模板快速开始</p>
            </div>
          </button>

          <button onClick={() => setShowAIDialog(true)} className="group relative overflow-hidden rounded-xl border border-canvas-border bg-canvas-panel p-6 text-left hover:border-neon-cyan/50 transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-neon-cyan" />
              </div>
              <h3 className="text-sm font-medium text-white font-display">AI 快速生成</h3>
              <p className="text-xs text-slate-500 mt-1">输入描述自动生成工作流</p>
            </div>
          </button>
        </div>

        {/* 项目列表 */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-white font-display">我的项目</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="搜索项目..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 mx-auto rounded-full bg-canvas-panel flex items-center justify-center mb-4">
                <Film className="w-8 h-8 text-slate-600" />
              </div>
              <p className="text-slate-400 mb-2">暂无项目</p>
              <p className="text-sm text-slate-600">点击上方"新建工作流"开始创作</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((project) => (
                <div
                  key={project.id}
                  className="group rounded-xl border border-canvas-border bg-canvas-panel overflow-hidden hover:border-neon-purple/30 transition-all"
                >
                  <div
                    className="aspect-video bg-canvas-hover cursor-pointer relative"
                    onClick={() => navigate(`/editor/${project.id}`)}
                  >
                    {project.thumbnailUrl ? (
                      <img
                        src={project.thumbnailUrl.startsWith('/') ? `${project.thumbnailUrl}${project.thumbnailUrl.includes('?') ? '&' : '?'}token=${localStorage.getItem('access_token') || ''}` : project.thumbnailUrl}
                        alt={project.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                          const placeholder = img.nextElementSibling as HTMLElement;
                          if (placeholder) placeholder.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className={`w-full h-full items-center justify-center ${project.thumbnailUrl ? 'hidden' : 'flex'}`}>
                      <Film className="w-8 h-8 text-slate-700" />
                    </div>
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ArrowRight className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  <div className="p-3">
                    <h3 className="text-sm font-medium text-slate-200 truncate">
                      {project.name}
                    </h3>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span className="text-xs text-slate-500">
                        {new Date(project.updatedAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-slate-600">
                        {project.nodeCount} 个节点
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPublishModal({ open: true, projectId: project.id, projectName: project.name });
                          }}
                          className="p-1 rounded hover:bg-canvas-hover transition-colors"
                          title="发布为模板"
                        >
                          <Share2 className="w-3.5 h-3.5 text-slate-600 hover:text-neon-purple" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProject(project.id);
                          }}
                          className="p-1 rounded hover:bg-canvas-hover transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-slate-600 hover:text-status-error" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 新建项目对话框 */}
      {showNewDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-canvas-panel border border-canvas-border rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-lg font-medium text-white font-display mb-4">新建工作流</h3>
            <input
              type="text"
              placeholder="项目名称"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewDialog(false)}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 发布为模板对话框 */}
      {publishModal.open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => !publishing && setPublishModal({ open: false, projectId: '', projectName: '' })}>
          <div
            className="bg-canvas-panel border border-canvas-border rounded-xl p-6 w-96 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white font-display">发布为模板</h3>
              <button
                onClick={() => !publishing && setPublishModal({ open: false, projectId: '', projectName: '' })}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">将「{publishModal.projectName}」发布到模板市场</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">分类</label>
                <select
                  value={publishCategory}
                  onChange={(e) => setPublishCategory(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
                >
                  <option value="官方">官方</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">标签（逗号分隔）</label>
                <input
                  type="text"
                  value={publishTags}
                  onChange={(e) => setPublishTags(e.target.value)}
                  placeholder="文生图, 图生视频"
                  className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPublishModal({ open: false, projectId: '', projectName: '' })}
                disabled={publishing}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {publishing ? '发布中...' : '发布'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 从模板创建对话框 */}
      {showTemplateDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowTemplateDialog(false)}>
          <div
            className="bg-canvas-panel border border-canvas-border rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white font-display">从模板创建</h3>
              <button onClick={() => setShowTemplateDialog(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 搜索 + 分类 */}
            <div className="flex gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="搜索模板..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-blue"
                />
              </div>
              <div className="flex gap-1">
                {['全部', '官方'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setTemplateCategory(cat)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      templateCategory === cat
                        ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                        : 'text-slate-400 hover:text-slate-200 border border-canvas-border'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 模板列表 */}
            {templateLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : templateList.length === 0 ? (
              <div className="text-center py-12 text-slate-500">暂无模板</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {templateList.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="rounded-lg border border-canvas-border bg-canvas-bg p-4 hover:border-neon-blue/30 transition-all"
                  >
                    <h4 className="text-sm font-medium text-white truncate">{tpl.name}</h4>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{tpl.description || '暂无描述'}</p>
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {tpl.template_category && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-neon-blue/10 text-neon-blue">
                          {tpl.template_category}
                        </span>
                      )}
                      {tpl.template_tags?.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-neon-purple/10 text-neon-purple">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => handleCloneTemplate(tpl)}
                      disabled={cloningId === tpl.id}
                      className="mt-3 w-full py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-blue to-neon-purple rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cloningId === tpl.id ? '克隆中...' : '使用此模板'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI 快速生成对话框 */}
      {showAIDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => !aiGenerating && setShowAIDialog(false)}>
          <div
            className="bg-canvas-panel border border-canvas-border rounded-xl p-6 w-96 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white font-display">AI 快速生成</h3>
              <button onClick={() => !aiGenerating && setShowAIDialog(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">工作流描述</label>
                <textarea
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="描述你想创建的工作流，例如：文生图 → 图片增强 → 图生视频"
                  rows={4}
                  className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-cyan resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider">AI 模型</label>
                <select
                  value={aiModelId}
                  onChange={(e) => setAiModelId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-cyan"
                >
                  {aiLlmModels.length === 0 && <option value="">暂无可用模型</option>}
                  {aiLlmModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => !aiGenerating && setShowAIDialog(false)}
                disabled={aiGenerating}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleAIGenerate}
                disabled={aiGenerating}
                className="px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-cyan to-neon-purple rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {aiGenerating && (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {aiGenerating ? '生成中...' : '生成工作流'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
