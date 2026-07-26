// AI 模型标签页
// 从原 Settings.tsx AiConfigTab 中 Model 部分（第 501-571、668-808 行 + ModelForm 第 331-433 行 + ModelCard 第 813-889 行）迁移
// 改造为受控组件：CRUD 由父容器传入回调，本组件不再直接调用 API
import { useState } from 'react';
import { Cpu, Plus, Edit2, Trash2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';
import type {
  AiProviderResponse,
  AiModelResponse,
  AiModelCreateRequest,
  AiModelUpdateRequest,
} from '@/utils/apiClient';
import { Modal, Toggle } from './Modal';
import { MODEL_TYPE_OPTIONS, modelTypeMeta } from './constants';

interface AiModelSectionProps {
  models: AiModelResponse[];
  providers: AiProviderResponse[];
  onCreate: (data: AiModelCreateRequest) => Promise<void>;
  onUpdate: (id: string, data: AiModelUpdateRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string, modelType: string) => Promise<void>;
}

// ── Model 表单 ──

function ModelForm({
  providers,
  initial,
  onSubmit,
  onCancel,
}: {
  providers: AiProviderResponse[];
  initial?: AiModelResponse;
  onSubmit: (data: AiModelCreateRequest | AiModelUpdateRequest) => void;
  onCancel: () => void;
}) {
  const [providerId, setProviderId] = useState(initial?.provider_id ?? (providers[0]?.id ?? ''));
  const [modelId, setModelId] = useState(initial?.model_id ?? '');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [modelType, setModelType] = useState(initial?.model_type ?? 'llm');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (initial) {
      const data: AiModelUpdateRequest = { provider_id: providerId, model_id: modelId, display_name: displayName, model_type: modelType, is_active: isActive, is_default: isDefault };
      onSubmit(data);
    } else {
      onSubmit({ provider_id: providerId, model_id: modelId, display_name: displayName, model_type: modelType, is_active: isActive, is_default: isDefault });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">关联 Provider</label>
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">模型 ID</label>
        <input
          required
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="gpt-4o / doubao-pro-32k ..."
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">显示名称</label>
        <input
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">模型类型</label>
        <select
          value={modelType}
          onChange={(e) => setModelType(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
        >
          {MODEL_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-500 uppercase tracking-wider">启用</label>
        <Toggle checked={isActive} onChange={setIsActive} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1">
          <Star className="w-3 h-3 text-amber-400" /> 设为默认
        </label>
        <Toggle checked={isDefault} onChange={setIsDefault} />
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

// ── 模型卡片 ──

function ModelCard({
  model,
  providerName,
  onToggle,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  model: AiModelResponse;
  providerName: string;
  onToggle: () => void;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = modelTypeMeta(model.model_type);

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
      model.is_active
        ? 'border-canvas-border bg-canvas-panel hover:bg-canvas-hover'
        : 'border-canvas-border/50 bg-canvas-panel/50 opacity-60'
    }`}>
      {/* 左侧：模型信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{model.display_name}</span>
          {model.is_default && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/20 text-amber-400">
              <Star className="w-2.5 h-2.5 fill-amber-400" /> 默认
            </span>
          )}
          <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded-full font-medium ${meta.color}`}>
            {meta.label}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">
          {model.model_id} · {providerName}
        </div>
      </div>

      {/* 右侧：操作 */}
      <div className="flex items-center gap-2">
        {!model.is_default && model.is_active && (
          <button
            onClick={onSetDefault}
            title="设为默认"
            className="p-1.5 text-slate-500 hover:text-amber-400 rounded transition-colors opacity-0 group-hover:opacity-100"
          >
            <Star className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onToggle}
          title={model.is_active ? '停用' : '启用'}
          className="p-1.5 rounded transition-colors"
        >
          <div className={`w-2 h-2 rounded-full ${model.is_active ? 'bg-green-500' : 'bg-slate-600'}`} />
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 text-slate-500 hover:text-neon-blue rounded transition-colors opacity-0 group-hover:opacity-100"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-slate-500 hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── AI Model Section ──

export function AiModelSection({
  models,
  providers,
  onCreate,
  onUpdate,
  onDelete,
  onSetDefault,
}: AiModelSectionProps) {
  const [modal, setModal] = useState<{ open: boolean; editing?: AiModelResponse }>({ open: false });
  const [modelTypeFilter, setModelTypeFilter] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);

  const handleSubmit = async (data: AiModelCreateRequest | AiModelUpdateRequest) => {
    try {
      if (modal.editing) {
        await onUpdate(modal.editing.id, data as AiModelUpdateRequest);
        toast.success('Model 已更新');
      } else {
        await onCreate(data as AiModelCreateRequest);
        toast.success('Model 已添加');
      }
      setModal({ open: false });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_model_save');
      toast.error(msg);
    }
  };

  const handleToggle = async (m: AiModelResponse) => {
    try {
      await onUpdate(m.id, { is_active: !m.is_active });
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_model_save');
      toast.error(msg);
    }
  };

  const handleDelete = async (m: AiModelResponse) => {
    if (!confirm(`确定删除 Model「${m.display_name}」？`)) return;
    try {
      await onDelete(m.id);
      toast.success('Model 已删除');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_model_delete');
      toast.error(msg);
    }
  };

  const handleSetDefault = async (m: AiModelResponse) => {
    try {
      await onSetDefault(m.id, m.model_type);
      toast.success(`已将「${m.display_name}」设为默认`);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_model_default');
      toast.error(msg);
    }
  };

  // 按 provider 过滤
  let filteredModels = providerFilter
    ? models.filter((m) => m.provider_id === providerFilter)
    : models;

  // 按 model_type 筛选
  if (modelTypeFilter) {
    filteredModels = filteredModels.filter((m) => m.model_type === modelTypeFilter);
  }

  // 按 model_type 分组
  const groupedModels = MODEL_TYPE_OPTIONS.map((type) => ({
    ...type,
    models: filteredModels.filter((m) => m.model_type === type.value),
  })).filter((g) => g.models.length > 0);

  // 未分类的模型
  const categorizedTypes = new Set(MODEL_TYPE_OPTIONS.map((o) => o.value));
  const uncategorizedModels = filteredModels.filter((m) => !categorizedTypes.has(m.model_type as typeof categorizedTypes extends Set<infer T> ? T : never));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-neon-purple" />
          <h2 className="text-base font-medium text-white font-display">AI 模型</h2>
          <span className="text-xs text-slate-500">({filteredModels.length})</span>
        </div>
        <button
          onClick={() => setModal({ open: true })}
          disabled={providers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          添加模型
        </button>
      </div>

      {/* Provider 筛选 + 模型类型筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Provider 筛选下拉 */}
        <select
          value={providerFilter ?? ''}
          onChange={(e) => setProviderFilter(e.target.value || null)}
          className="px-2.5 py-1 text-xs bg-canvas-bg border border-canvas-border rounded-full text-slate-300 focus:outline-none focus:border-neon-purple"
        >
          <option value="">全部 Provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* 模型类型筛选标签 */}
        <button
          onClick={() => setModelTypeFilter(null)}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            modelTypeFilter === null
              ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40'
              : 'bg-canvas-bg text-slate-400 border border-canvas-border hover:text-slate-300'
          }`}
        >
          全部类型
        </button>
        {MODEL_TYPE_OPTIONS.map((t) => {
          const count = (providerFilter
            ? models.filter((m) => m.provider_id === providerFilter)
            : models
          ).filter((m) => m.model_type === t.value).length;
          if (count === 0) return null;
          return (
            <button
              key={t.value}
              onClick={() => setModelTypeFilter(modelTypeFilter === t.value ? null : t.value)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                modelTypeFilter === t.value
                  ? `${t.color} border border-current/30`
                  : 'bg-canvas-bg text-slate-400 border border-canvas-border hover:text-slate-300'
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 模型列表区域 */}
      {providers.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">请先添加 Provider</p>
      ) : filteredModels.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">暂无模型，点击上方按钮添加</p>
      ) : (
        <div className="space-y-4">
          {groupedModels.map((group) => (
            <div key={group.value} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${group.color}`}>
                  {group.label}
                </span>
                <span className="text-xs text-slate-500">{group.models.length}</span>
              </div>
              <div className="grid gap-2">
                {group.models.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    providerName={providers.find((p) => p.id === m.provider_id)?.name ?? ''}
                    onToggle={() => handleToggle(m)}
                    onSetDefault={() => handleSetDefault(m)}
                    onEdit={() => setModal({ open: true, editing: m })}
                    onDelete={() => handleDelete(m)}
                  />
                ))}
              </div>
            </div>
          ))}

          {uncategorizedModels.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 text-xs rounded-full font-medium bg-slate-500/20 text-slate-400">
                  其他
                </span>
              </div>
              <div className="grid gap-2">
                {uncategorizedModels.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    providerName={providers.find((p) => p.id === m.provider_id)?.name ?? ''}
                    onToggle={() => handleToggle(m)}
                    onSetDefault={() => handleSetDefault(m)}
                    onEdit={() => setModal({ open: true, editing: m })}
                    onDelete={() => handleDelete(m)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model 模态框 */}
      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        title={modal.editing ? '编辑模型' : '添加模型'}
      >
        <ModelForm
          providers={providers}
          initial={modal.editing}
          onSubmit={handleSubmit}
          onCancel={() => setModal({ open: false })}
        />
      </Modal>
    </div>
  );
}
