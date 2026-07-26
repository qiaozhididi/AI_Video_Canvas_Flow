// AI 服务商标签页
// 从原 Settings.tsx AiConfigTab 中 Provider 部分（第 437-499、580-666、782-794 行 + ProviderForm 第 135-329 行）迁移
// 改造为受控组件：CRUD 由父容器传入回调，本组件不再直接调用 API
import { useState } from 'react';
import { Server, Plus, Edit2, Trash2, Search, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';
import type {
  AiProviderResponse,
  AiProviderCreateRequest,
  AiProviderUpdateRequest,
  AiModelResponse,
} from '@/utils/apiClient';
import { Modal, Toggle } from './Modal';
import {
  PROVIDER_PRESETS,
  platformPreset,
  platformLabel,
  platformIcon,
  platformColor,
  type ProviderPreset,
} from './constants';

interface AiProviderSectionProps {
  providers: AiProviderResponse[];
  models: AiModelResponse[];
  onCreate: (data: AiProviderCreateRequest) => Promise<void>;
  onUpdate: (id: string, data: AiProviderUpdateRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

// ── Provider 表单（两步向导） ──

function ProviderForm({
  initial,
  onSubmit,
  onCancel,
  existingPlatforms,
}: {
  initial?: AiProviderResponse;
  onSubmit: (data: AiProviderCreateRequest | AiProviderUpdateRequest) => void;
  onCancel: () => void;
  existingPlatforms?: string[];
}) {
  // 编辑模式：直接进入第二步
  const [step, setStep] = useState<'select' | 'configure'>(initial ? 'configure' : 'select');
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(
    initial ? platformPreset(initial.platform) ?? null : null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [name, setName] = useState(initial?.name ?? '');
  const [platform, setPlatform] = useState(initial?.platform ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  // 选择平台后自动填充
  const handleSelectPreset = (preset: ProviderPreset) => {
    setSelectedPreset(preset);
    setPlatform(preset.value);
    setBaseUrl(preset.defaultBaseUrl);
    setName(preset.label);
    setStep('configure');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (initial) {
      const data: AiProviderUpdateRequest = { name, platform, base_url: baseUrl, is_active: isActive };
      if (apiKey) data.api_key = apiKey;
      onSubmit(data);
    } else {
      onSubmit({ name, platform, base_url: baseUrl, api_key: apiKey, is_active: isActive });
    }
  };

  // 第一步：选择平台
  if (step === 'select') {
    const filtered = searchQuery
      ? PROVIDER_PRESETS.filter((p) =>
          p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : PROVIDER_PRESETS;

    return (
      <div className="space-y-3">
        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索平台..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
          />
        </div>

        {/* 平台卡片网格 */}
        <div className="grid grid-cols-3 gap-2 max-h-[360px] overflow-y-auto pr-1">
          {filtered.map((preset) => {
            const alreadyAdded = existingPlatforms?.includes(preset.value);
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`group relative flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center transition-colors ${
                  alreadyAdded
                    ? 'border-canvas-border/50 bg-canvas-panel/50 hover:bg-canvas-hover'
                    : 'border-canvas-border bg-canvas-panel hover:bg-canvas-hover hover:border-neon-purple/40'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${preset.color}`}>
                  {preset.icon}
                </div>
                <span className="text-xs font-medium text-slate-300 leading-tight line-clamp-1">{preset.label}</span>
                <span className="text-[10px] text-slate-500 leading-tight line-clamp-2">{preset.description}</span>
                {alreadyAdded && (
                  <span className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-neon-purple/20 text-neon-purple">已添加</span>
                )}
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-6 text-sm text-slate-500">未找到匹配的平台</div>
        )}
      </div>
    );
  }

  // 第二步：配置详情
  const isCustom = platform === 'custom';
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 返回按钮 + 选中平台标识 */}
      {!initial && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep('select')}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          {selectedPreset && (
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${selectedPreset.color}`}>
                {selectedPreset.icon}
              </div>
              <span className="text-sm text-white font-medium">{selectedPreset.label}</span>
            </div>
          )}
        </div>
      )}

      {isCustom && (
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider">平台标识</label>
          <input
            required
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="my-provider"
            className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
          />
        </div>
      )}
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">名称</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">Base URL</label>
        <input
          required={!isCustom}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={isCustom ? 'https://your-api-endpoint/v1' : ''}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">
          API Key {initial && <span className="text-slate-600 normal-case">（留空则不修改）</span>}
        </label>
        <input
          type="password"
          required={!initial}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={initial ? '••••••••' : 'sk-...'}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-500 uppercase tracking-wider">启用</label>
        <Toggle checked={isActive} onChange={setIsActive} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-400 border border-canvas-border rounded-lg hover:text-white"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity"
        >
          {initial ? '保存' : '添加'}
        </button>
      </div>
    </form>
  );
}

// ── AI Provider Section ──

export function AiProviderSection({ providers, models, onCreate, onUpdate, onDelete }: AiProviderSectionProps) {
  const [modal, setModal] = useState<{ open: boolean; editing?: AiProviderResponse }>({ open: false });

  const handleSubmit = async (data: AiProviderCreateRequest | AiProviderUpdateRequest) => {
    try {
      if (modal.editing) {
        await onUpdate(modal.editing.id, data as AiProviderUpdateRequest);
        toast.success('Provider 已更新');
      } else {
        await onCreate(data as AiProviderCreateRequest);
        toast.success('Provider 已添加');
      }
      setModal({ open: false });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_provider_save');
      toast.error(msg);
    }
  };

  const handleToggle = async (p: AiProviderResponse) => {
    try {
      await onUpdate(p.id, { is_active: !p.is_active });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_provider_save');
      toast.error(msg);
    }
  };

  const handleDelete = async (p: AiProviderResponse) => {
    if (!confirm(`确定删除 Provider「${p.name}」？关联的 Models 也会被级联删除。`)) return;
    try {
      await onDelete(p.id);
      toast.success('Provider 已删除');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_provider_delete');
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-neon-purple" />
          <h2 className="text-base font-medium text-white font-display">AI 服务商</h2>
          <span className="text-xs text-slate-500">({providers.length})</span>
        </div>
        <button
          onClick={() => setModal({ open: true })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" />
          添加 Provider
        </button>
      </div>

      {providers.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">暂无 Provider，点击上方按钮添加</p>
      ) : (
        <div className="rounded-xl border border-canvas-border bg-canvas-panel divide-y divide-canvas-border overflow-hidden">
          {providers.map((p) => {
            const pModels = models.filter((m) => m.provider_id === p.id);
            return (
              <div
                key={p.id}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas-hover"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  p.is_active ? platformColor(p.platform) : 'bg-canvas-bg text-slate-500'
                }`}>
                  {platformIcon(p.platform)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{p.name}</span>
                    {!p.is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">停用</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {platformLabel(p.platform)} · {pModels.length} 个模型
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">启用</span>
                  <Toggle checked={p.is_active} onChange={() => handleToggle(p)} />
                  <button
                    onClick={() => setModal({ open: true, editing: p })}
                    className="p-1.5 text-slate-500 hover:text-neon-blue rounded transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="p-1.5 text-slate-500 hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Provider 模态框 */}
      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        title={modal.editing ? '编辑 Provider' : '添加 Provider'}
      >
        <ProviderForm
          initial={modal.editing}
          onSubmit={handleSubmit}
          onCancel={() => setModal({ open: false })}
          existingPlatforms={providers.map((p) => p.platform)}
        />
      </Modal>
    </div>
  );
}
