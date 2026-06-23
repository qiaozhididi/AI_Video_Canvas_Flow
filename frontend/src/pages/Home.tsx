import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import {
  Plus, Search, Clock, Trash2, Film, Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useState } from 'react';

export default function Home() {
  const { projects, createProject, deleteProject } = useProjectStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    const name = newProjectName.trim() || `项目 ${projects.length + 1}`;
    const project = createProject(name);
    setShowNewDialog(false);
    setNewProjectName('');
    navigate(`/editor/${project.id}`);
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

          <button className="group relative overflow-hidden rounded-xl border border-canvas-border bg-canvas-panel p-6 text-left hover:border-neon-blue/50 transition-all">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-blue/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-10 h-10 rounded-lg bg-neon-blue/20 flex items-center justify-center mb-3">
                <Film className="w-5 h-5 text-neon-blue" />
              </div>
              <h3 className="text-sm font-medium text-white font-display">从模板创建</h3>
              <p className="text-xs text-slate-500 mt-1">使用预设模板快速开始</p>
            </div>
          </button>

          <button className="group relative overflow-hidden rounded-xl border border-canvas-border bg-canvas-panel p-6 text-left hover:border-neon-cyan/50 transition-all">
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
                      <img src={project.thumbnailUrl} alt={project.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-8 h-8 text-slate-700" />
                      </div>
                    )}
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
                        {project.canvasNodes.length} 个节点
                      </span>
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
    </div>
  );
}
