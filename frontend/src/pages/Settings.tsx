import { useState, useEffect, useCallback } from 'react';
import {
  User, Key, HardDrive, CreditCard, Save,
  Server, Cpu, Plus, Edit2, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  aiApi,
  type AiProviderResponse,
  type AiProviderCreateRequest,
  type AiProviderUpdateRequest,
  type AiModelResponse,
  type AiModelCreateRequest,
  type AiModelUpdateRequest,
} from '../utils/apiClient';

// ── 常量 ──

const PLATFORM_OPTIONS = [
  { value: 'volcengine', label: '火山引擎' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'custom', label: '自定义' },
] as const;

const MODEL_TYPE_OPTIONS = [
  { value: 'llm', label: '文本生成' },
  { value: 'image_gen', label: '文生图' },
  { value: 'video_gen', label: '图生视频' },
  { value: 'tts', label: '语音合成' },
] as const;

// ── 通用组件 ──

function Modal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-canvas-border bg-canvas-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-neon-purple' : 'bg-canvas-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// ── Provider 表单 ──

function ProviderForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AiProviderResponse;
  onSubmit: (data: AiProviderCreateRequest | AiProviderUpdateRequest) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [platform, setPlatform] = useState(initial?.platform ?? 'volcengine');
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

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

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
        <label className="text-xs text-slate-500 uppercase tracking-wider">平台</label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
        >
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wider">Base URL</label>
        <input
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (initial) {
      const data: AiModelUpdateRequest = { provider_id: providerId, model_id: modelId, display_name: displayName, model_type: modelType, is_active: isActive };
      onSubmit(data);
    } else {
      onSubmit({ provider_id: providerId, model_id: modelId, display_name: displayName, model_type: modelType, is_active: isActive });
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

// ── AI 配置标签页 ──

function AiConfigTab() {
  const [providers, setProviders] = useState<AiProviderResponse[]>([]);
  const [models, setModels] = useState<AiModelResponse[]>([]);
  const [loading, setLoading] = useState(true);

  // Provider 模态框
  const [providerModal, setProviderModal] = useState<{ open: boolean; editing?: AiProviderResponse }>({ open: false });
  // Model 模态框
  const [modelModal, setModelModal] = useState<{ open: boolean; editing?: AiModelResponse }>({ open: false });

  const fetchProviders = useCallback(() => aiApi.providers.list().then(setProviders), []);
  const fetchModels = useCallback(() => aiApi.models.list().then(setModels), []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProviders(), fetchModels()]).finally(() => setLoading(false));
  }, [fetchProviders, fetchModels]);

  // ── Provider 操作 ──

  const handleProviderSubmit = async (data: AiProviderCreateRequest | AiProviderUpdateRequest) => {
    try {
      if (providerModal.editing) {
        await aiApi.providers.update(providerModal.editing.id, data as AiProviderUpdateRequest);
        toast.success('Provider 已更新');
      } else {
        await aiApi.providers.create(data as AiProviderCreateRequest);
        toast.success('Provider 已添加');
      }
      setProviderModal({ open: false });
      fetchProviders();
      fetchModels(); // provider 变更可能影响 model 显示
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
    }
  };

  const handleProviderToggle = async (p: AiProviderResponse) => {
    try {
      await aiApi.providers.update(p.id, { is_active: !p.is_active });
      fetchProviders();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
    }
  };

  const handleProviderDelete = async (p: AiProviderResponse) => {
    if (!confirm(`确定删除 Provider「${p.name}」？关联的 Models 也会被级联删除。`)) return;
    try {
      await aiApi.providers.delete(p.id);
      toast.success('Provider 已删除');
      fetchProviders();
      fetchModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
    }
  };

  // ── Model 操作 ──

  const handleModelSubmit = async (data: AiModelCreateRequest | AiModelUpdateRequest) => {
    try {
      if (modelModal.editing) {
        await aiApi.models.update(modelModal.editing.id, data as AiModelUpdateRequest);
        toast.success('Model 已更新');
      } else {
        await aiApi.models.create(data as AiModelCreateRequest);
        toast.success('Model 已添加');
      }
      setModelModal({ open: false });
      fetchModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
    }
  };

  const handleModelToggle = async (m: AiModelResponse) => {
    try {
      await aiApi.models.update(m.id, { is_active: !m.is_active });
      fetchModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
    }
  };

  const handleModelDelete = async (m: AiModelResponse) => {
    if (!confirm(`确定删除 Model「${m.display_name}」？`)) return;
    try {
      await aiApi.models.delete(m.id);
      toast.success('Model 已删除');
      fetchModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast.error(msg);
    }
  };

  const providerNameMap = Object.fromEntries(providers.map((p) => [p.id, p.name]));

  const modelTypeLabel = (t: string) => MODEL_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
  const platformLabel = (t: string) => PLATFORM_OPTIONS.find((o) => o.value === t)?.label ?? t;

  if (loading) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }

  return (
    <div className="space-y-8">
      {/* Provider 管理 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-neon-purple" />
            <h2 className="text-lg font-medium text-white font-display">Provider 管理</h2>
          </div>
          <button
            onClick={() => setProviderModal({ open: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            添加 Provider
          </button>
        </div>

        {providers.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">暂无 Provider，点击上方按钮添加</p>
        ) : (
          <div className="rounded-xl border border-canvas-border bg-canvas-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-canvas-border text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">名称</th>
                  <th className="px-4 py-3 text-left">平台</th>
                  <th className="px-4 py-3 text-left">Base URL</th>
                  <th className="px-4 py-3 text-left">API Key</th>
                  <th className="px-4 py-3 text-center">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b border-canvas-border last:border-b-0 hover:bg-canvas-hover/50">
                    <td className="px-4 py-3 text-slate-300">{p.name}</td>
                    <td className="px-4 py-3 text-slate-400">{platformLabel(p.platform)}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.base_url}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.api_key}</td>
                    <td className="px-4 py-3 text-center">
                      <Toggle checked={p.is_active} onChange={() => handleProviderToggle(p)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setProviderModal({ open: true, editing: p })}
                          className="p-1.5 text-slate-400 hover:text-neon-blue rounded transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleProviderDelete(p)}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Model 管理 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-neon-purple" />
            <h2 className="text-lg font-medium text-white font-display">Model 管理</h2>
          </div>
          <button
            onClick={() => setModelModal({ open: true })}
            disabled={providers.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            添加 Model
          </button>
        </div>

        {providers.length === 0 ? (
          <p className="text-sm text-slate-500 py-2">请先添加 Provider</p>
        ) : models.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">暂无 Model，点击上方按钮添加</p>
        ) : (
          <div className="rounded-xl border border-canvas-border bg-canvas-panel overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-canvas-border text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">显示名称</th>
                  <th className="px-4 py-3 text-left">模型 ID</th>
                  <th className="px-4 py-3 text-left">类型</th>
                  <th className="px-4 py-3 text-left">Provider</th>
                  <th className="px-4 py-3 text-center">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-b border-canvas-border last:border-b-0 hover:bg-canvas-hover/50">
                    <td className="px-4 py-3 text-slate-300">{m.display_name}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{m.model_id}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-neon-purple/20 text-neon-purple">
                        {modelTypeLabel(m.model_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{providerNameMap[m.provider_id] ?? m.provider_id}</td>
                    <td className="px-4 py-3 text-center">
                      <Toggle checked={m.is_active} onChange={() => handleModelToggle(m)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setModelModal({ open: true, editing: m })}
                          className="p-1.5 text-slate-400 hover:text-neon-blue rounded transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleModelDelete(m)}
                          className="p-1.5 text-slate-400 hover:text-red-400 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Provider 模态框 */}
      <Modal
        open={providerModal.open}
        onClose={() => setProviderModal({ open: false })}
        title={providerModal.editing ? '编辑 Provider' : '添加 Provider'}
      >
        <ProviderForm
          initial={providerModal.editing}
          onSubmit={handleProviderSubmit}
          onCancel={() => setProviderModal({ open: false })}
        />
      </Modal>

      {/* Model 模态框 */}
      <Modal
        open={modelModal.open}
        onClose={() => setModelModal({ open: false })}
        title={modelModal.editing ? '编辑 Model' : '添加 Model'}
      >
        <ModelForm
          providers={providers}
          initial={modelModal.editing}
          onSubmit={handleModelSubmit}
          onCancel={() => setModelModal({ open: false })}
        />
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [displayName, setDisplayName] = useState('用户');
  const [email, setEmail] = useState('user@example.com');

  const tabs = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'api', label: 'API 配置', icon: Key },
    { id: 'ai', label: 'AI 配置', icon: Server },
    { id: 'storage', label: '存储用量', icon: HardDrive },
    { id: 'subscription', label: '订阅管理', icon: CreditCard },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-white font-display mb-6">设置</h1>

        <div className="flex gap-6">
          {/* 侧边标签 */}
          <div className="w-48 space-y-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                  activeTab === id
                    ? 'bg-neon-purple/20 text-neon-purple'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-canvas-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* 内容 */}
          <div className="flex-1">
            {activeTab === 'profile' && (
              <div className="space-y-4">
                <h2 className="text-lg font-medium text-white font-display">个人信息</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wider">显示名称</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full mt-1 px-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wider">邮箱</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full mt-1 px-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
                    />
                  </div>
                </div>
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity">
                  <Save className="w-4 h-4" />
                  保存修改
                </button>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-4">
                <h2 className="text-lg font-medium text-white font-display">API 配置</h2>
                <p className="text-sm text-slate-400">配置第三方 AI 模型的 API Key</p>
                <div className="space-y-3">
                  {['OpenAI API Key', 'Stability AI Key', 'Kling API Key', 'CosyVoice API Key'].map((key) => (
                    <div key={key}>
                      <label className="text-xs text-slate-500">{key}</label>
                      <input
                        type="password"
                        placeholder="sk-..."
                        className="w-full mt-1 px-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
                      />
                    </div>
                  ))}
                </div>
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity">
                  <Save className="w-4 h-4" />
                  保存配置
                </button>
              </div>
            )}

            {activeTab === 'ai' && <AiConfigTab />}

            {activeTab === 'storage' && (
              <div className="space-y-4">
                <h2 className="text-lg font-medium text-white font-display">存储用量</h2>
                <div className="rounded-xl border border-canvas-border bg-canvas-panel p-4 space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-300">已使用</span>
                      <span className="text-slate-400">2.4 GB / 10 GB</span>
                    </div>
                    <div className="w-full h-2 bg-canvas-border rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-neon-purple to-neon-blue rounded-full" style={{ width: '24%' }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-canvas-bg rounded-lg">
                      <p className="text-lg font-bold text-white font-display">156</p>
                      <p className="text-xs text-slate-500">图片</p>
                    </div>
                    <div className="p-3 bg-canvas-bg rounded-lg">
                      <p className="text-lg font-bold text-white font-display">23</p>
                      <p className="text-xs text-slate-500">视频</p>
                    </div>
                    <div className="p-3 bg-canvas-bg rounded-lg">
                      <p className="text-lg font-bold text-white font-display">45</p>
                      <p className="text-xs text-slate-500">音频</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'subscription' && (
              <div className="space-y-4">
                <h2 className="text-lg font-medium text-white font-display">订阅管理</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-canvas-border bg-canvas-panel p-6">
                    <h3 className="text-sm font-medium text-slate-300 mb-2">免费版</h3>
                    <p className="text-2xl font-bold text-white font-display mb-4">¥0<span className="text-sm text-slate-500">/月</span></p>
                    <ul className="space-y-1.5 text-xs text-slate-400">
                      <li>3 个工作流项目</li>
                      <li>10 GB 存储</li>
                      <li>基础 AI 模型</li>
                    </ul>
                    <button className="w-full mt-4 py-1.5 text-xs text-slate-400 border border-canvas-border rounded-lg">
                      当前方案
                    </button>
                  </div>
                  <div className="rounded-xl border-2 border-neon-purple bg-canvas-panel p-6 relative">
                    <span className="absolute -top-2.5 left-4 px-2 py-0.5 text-[10px] font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-full">
                      推荐
                    </span>
                    <h3 className="text-sm font-medium text-slate-300 mb-2">专业版</h3>
                    <p className="text-2xl font-bold text-white font-display mb-4">¥99<span className="text-sm text-slate-500">/月</span></p>
                    <ul className="space-y-1.5 text-xs text-slate-400">
                      <li>无限工作流项目</li>
                      <li>100 GB 存储</li>
                      <li>全部 AI 模型</li>
                      <li>GPU 渲染加速</li>
                    </ul>
                    <button className="w-full mt-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity">
                      升级
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
