import { useState, useEffect, useCallback } from 'react';
import {
  User, HardDrive, Save,
  Server, Cpu, Plus, Edit2, Trash2, X, Star, Check, Search, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';
import {
  aiApi,
  authApi,
  mediaApi,
  type AiProviderResponse,
  type AiProviderCreateRequest,
  type AiProviderUpdateRequest,
  type AiModelResponse,
  type AiModelCreateRequest,
  type AiModelUpdateRequest,
  type UserResponse,
  type UserUpdateRequest,
  type StorageStatsResponse,
  type StorageUsageResponse,
} from '../utils/apiClient';

// ── 常量 ──

interface ProviderPreset {
  value: string;
  label: string;
  description: string;
  defaultBaseUrl: string;
  supportedTypes: string[];
  icon: string;
  color: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { value: 'volcengine', label: '火山引擎', description: '豆包系列、SeedReam 图片/视频生成', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', supportedTypes: ['llm', 'image_gen', 'video_gen', 'tts'], icon: '火', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'openai', label: 'OpenAI', description: 'GPT-4o, DALL·E, TTS 等', defaultBaseUrl: 'https://api.openai.com/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: 'O', color: 'bg-green-500/20 text-green-400' },
  { value: 'deepseek', label: 'DeepSeek', description: 'deepseek-chat, deepseek-reasoner', defaultBaseUrl: 'https://api.deepseek.com/v1', supportedTypes: ['llm'], icon: 'D', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'aliyun', label: '阿里云 DashScope', description: '通义千问 Qwen 系列', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: '阿', color: 'bg-violet-500/20 text-violet-400' },
  { value: 'zhipu', label: '智谱 BigModel', description: 'GLM-4, CogView 图片生成', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', supportedTypes: ['llm', 'image_gen'], icon: '智', color: 'bg-cyan-500/20 text-cyan-400' },
  { value: 'moonshot', label: '月之暗面 Moonshot', description: 'Kimi k2, moonshot-v1', defaultBaseUrl: 'https://api.moonshot.ai/v1', supportedTypes: ['llm'], icon: '月', color: 'bg-indigo-500/20 text-indigo-400' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude 3.5/4 系列', defaultBaseUrl: 'https://api.anthropic.com/v1', supportedTypes: ['llm'], icon: 'A', color: 'bg-amber-500/20 text-amber-400' },
  { value: 'gemini', label: 'Google Gemini', description: 'Gemini 2.5 Pro/Flash', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', supportedTypes: ['llm'], icon: 'G', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'azure_openai', label: 'Azure OpenAI', description: 'Azure 部署的 GPT 系列', defaultBaseUrl: 'https://{resource}.openai.azure.com', supportedTypes: ['llm', 'image_gen', 'tts'], icon: 'Az', color: 'bg-sky-500/20 text-sky-400' },
  { value: 'siliconflow', label: '硅基流动 SiliconFlow', description: 'DeepSeek-V3, FLUX 图片生成', defaultBaseUrl: 'https://api.siliconflow.cn/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: '硅', color: 'bg-teal-500/20 text-teal-400' },
  { value: 'openrouter', label: 'OpenRouter', description: '聚合多平台模型路由', defaultBaseUrl: 'https://openrouter.ai/api/v1', supportedTypes: ['llm', 'image_gen'], icon: 'OR', color: 'bg-purple-500/20 text-purple-400' },
  { value: 'hunyuan', label: '腾讯混元', description: 'hunyuan-turbo, 混元图片生成', defaultBaseUrl: 'https://hunyuan.cloud.tencent.com', supportedTypes: ['llm', 'image_gen'], icon: '混', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'minimax', label: 'MiniMax', description: 'abab7, TTS 语音合成', defaultBaseUrl: 'https://api.minimax.chat/v1', supportedTypes: ['llm', 'tts'], icon: 'MM', color: 'bg-pink-500/20 text-pink-400' },
  { value: 'qianfan', label: '百度千帆', description: 'ERNIE-4.0, 文心系列', defaultBaseUrl: 'https://qianfan.baidubce.com/v2', supportedTypes: ['llm'], icon: '千', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'qiniu', label: '七牛云', description: 'AI 推理服务', defaultBaseUrl: 'https://qiniuapi.com', supportedTypes: ['llm'], icon: '七', color: 'bg-lime-500/20 text-lime-400' },
  { value: 'nvidia', label: 'NVIDIA', description: 'NIM 推理服务', defaultBaseUrl: 'https://integrate.api.nvidia.com', supportedTypes: ['llm'], icon: 'NV', color: 'bg-green-500/20 text-green-400' },
  { value: 'novita', label: 'Novita AI', description: 'SDXL, FLUX 图片生成', defaultBaseUrl: 'https://api.novita.ai/v3', supportedTypes: ['llm', 'image_gen'], icon: 'No', color: 'bg-fuchsia-500/20 text-fuchsia-400' },
  { value: 'gpustack', label: 'GPUStack', description: '私有化部署推理服务', defaultBaseUrl: '', supportedTypes: ['llm'], icon: 'GP', color: 'bg-slate-500/20 text-slate-400' },
  { value: 'jina', label: 'Jina AI', description: 'Embedding, Rerank 服务', defaultBaseUrl: 'https://api.jina.ai/v1', supportedTypes: ['llm'], icon: 'J', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'mimo', label: '小米 MiMo', description: 'MiMo 推理模型', defaultBaseUrl: 'https://xiaomimimo.com', supportedTypes: ['llm'], icon: '米', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'modelscope', label: '魔搭 ModelScope', description: 'ModelScope 模型推理', defaultBaseUrl: 'https://modelscope.cn', supportedTypes: ['llm'], icon: '魔', color: 'bg-rose-500/20 text-rose-400' },
  { value: 'longcat', label: 'LongCat AI', description: '美团 LongCat 推理', defaultBaseUrl: 'https://longcat.chat', supportedTypes: ['llm'], icon: 'LC', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'lkeap', label: '腾讯云 LKEAP', description: '知识引擎原子能力', defaultBaseUrl: 'https://lkeap.cloud.tencent.com', supportedTypes: ['llm'], icon: 'LK', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'custom', label: '自定义 (OpenAI 兼容)', description: '自行配置 Base URL', defaultBaseUrl: '', supportedTypes: ['llm', 'image_gen', 'video_gen', 'tts'], icon: '+', color: 'bg-slate-500/20 text-slate-400' },
];

const MODEL_TYPE_OPTIONS = [
  { value: 'llm', label: '文本生成', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'image_gen', label: '文生图', color: 'bg-purple-500/20 text-purple-400' },
  { value: 'video_gen', label: '图生视频', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'tts', label: '语音合成', color: 'bg-amber-500/20 text-amber-400' },
] as const;

function modelTypeMeta(t: string) {
  return MODEL_TYPE_OPTIONS.find((o) => o.value === t) ?? { value: t, label: t, color: 'bg-slate-500/20 text-slate-400' };
}

function platformLabel(t: string) {
  return PROVIDER_PRESETS.find((o) => o.value === t)?.label ?? t;
}

function platformPreset(p: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((o) => o.value === p);
}

function platformIcon(p: string) {
  return platformPreset(p)?.icon ?? p.charAt(0).toUpperCase();
}

function platformColor(p: string) {
  return platformPreset(p)?.color ?? 'bg-slate-500/20 text-slate-400';
}

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
    setName(name || preset.label);
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

// ── AI 配置标签页（左右分栏） ──

function AiConfigTab() {
  const [providers, setProviders] = useState<AiProviderResponse[]>([]);
  const [models, setModels] = useState<AiModelResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelTypeFilter, setModelTypeFilter] = useState<string | null>(null);

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
      fetchModels();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_provider_save');
      toast.error(msg);
    }
  };

  const handleProviderToggle = async (p: AiProviderResponse) => {
    try {
      await aiApi.providers.update(p.id, { is_active: !p.is_active });
      fetchProviders();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_provider_save');
      toast.error(msg);
    }
  };

  const handleProviderDelete = async (p: AiProviderResponse) => {
    if (!confirm(`确定删除 Provider「${p.name}」？关联的 Models 也会被级联删除。`)) return;
    try {
      await aiApi.providers.delete(p.id);
      toast.success('Provider 已删除');
      if (selectedProviderId === p.id) setSelectedProviderId(null);
      fetchProviders();
      fetchModels();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_provider_delete');
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
      const msg = getErrorMessage(err, 'ai_model_save');
      toast.error(msg);
    }
  };

  const handleModelToggle = async (m: AiModelResponse) => {
    try {
      await aiApi.models.update(m.id, { is_active: !m.is_active });
      fetchModels();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_model_save');
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
      const msg = getErrorMessage(err, 'ai_model_delete');
      toast.error(msg);
    }
  };

  const handleSetDefault = async (m: AiModelResponse) => {
    try {
      await aiApi.models.update(m.id, { is_default: true });
      toast.success(`已将「${m.display_name}」设为默认`);
      fetchModels();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'ai_model_default');
      toast.error(msg);
    }
  };

  // 按选中 Provider 过滤模型
  let filteredModels = selectedProviderId
    ? models.filter((m) => m.provider_id === selectedProviderId)
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

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  if (loading) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }

  return (
    <div className="flex gap-5 min-h-[400px]">
      {/* 左栏：Provider 列表 */}
      <div className="w-56 flex-shrink-0 flex flex-col rounded-xl border border-canvas-border bg-canvas-panel">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-canvas-border">
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-neon-purple" />
            <span className="text-sm font-medium text-white">Provider</span>
            <span className="text-xs text-slate-500">({providers.length})</span>
          </div>
          <button
            onClick={() => setProviderModal({ open: true })}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* "全部"选项 */}
          <button
            onClick={() => setSelectedProviderId(null)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
              selectedProviderId === null
                ? 'bg-neon-purple/10 text-white border-l-2 border-neon-purple'
                : 'text-slate-400 hover:bg-canvas-hover border-l-2 border-transparent'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-canvas-bg flex items-center justify-center flex-shrink-0">
              <Cpu className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="font-medium text-[13px]">全部 Provider</div>
              <div className="text-[11px] text-slate-500">{models.length} 个模型</div>
            </div>
          </button>

          {providers.map((p) => {
            const pModels = models.filter((m) => m.provider_id === p.id);
            return (
              <div
                key={p.id}
                className={`group flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  selectedProviderId === p.id
                    ? 'bg-neon-purple/10 text-white border-l-2 border-neon-purple'
                    : 'text-slate-300 hover:bg-canvas-hover border-l-2 border-transparent'
                }`}
                onClick={() => setSelectedProviderId(p.id)}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  p.is_active ? platformColor(p.platform) : 'bg-canvas-bg text-slate-500'
                }`}>
                  {platformIcon(p.platform)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13px] truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{platformLabel(p.platform)} · {pModels.length} 个模型</div>
                </div>
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setProviderModal({ open: true, editing: p }); }}
                    className="p-1 text-slate-400 hover:text-neon-blue rounded transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleProviderDelete(p); }}
                    className="p-1 text-slate-400 hover:text-red-400 rounded transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {!p.is_active && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">停用</span>
                )}
              </div>
            );
          })}
        </div>

        {/* 左栏底部：Provider 开关 */}
        {selectedProvider && (
          <div className="px-3 py-2.5 border-t border-canvas-border flex items-center justify-between">
            <span className="text-xs text-slate-500">启用状态</span>
            <Toggle checked={selectedProvider.is_active} onChange={() => handleProviderToggle(selectedProvider)} />
          </div>
        )}
      </div>

      {/* 右栏：模型按类型分组 */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-neon-purple" />
            <h2 className="text-base font-medium text-white font-display">
              {selectedProvider ? selectedProvider.name : '全部模型'}
            </h2>
            <span className="text-xs text-slate-500">({filteredModels.length})</span>
          </div>
          <button
            onClick={() => setModelModal({ open: true })}
            disabled={providers.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            添加模型
          </button>
        </div>

        {/* 模型类型筛选标签 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setModelTypeFilter(null)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              modelTypeFilter === null
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40'
                : 'bg-canvas-bg text-slate-400 border border-canvas-border hover:text-slate-300'
            }`}
          >
            全部
          </button>
          {MODEL_TYPE_OPTIONS.map((t) => {
            const count = (selectedProviderId
              ? models.filter((m) => m.provider_id === selectedProviderId)
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

        {/* 模型列表区域 - 可滚动 */}
        <div className="overflow-y-auto max-h-[calc(100vh-320px)] space-y-4">

        {providers.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">请先添加 Provider</p>
        ) : filteredModels.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">暂无模型，点击上方按钮添加</p>
        ) : (
          <>
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
                      onToggle={() => handleModelToggle(m)}
                      onSetDefault={() => handleSetDefault(m)}
                      onEdit={() => setModelModal({ open: true, editing: m })}
                      onDelete={() => handleModelDelete(m)}
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
                      onToggle={() => handleModelToggle(m)}
                      onSetDefault={() => handleSetDefault(m)}
                      onEdit={() => setModelModal({ open: true, editing: m })}
                      onDelete={() => handleModelDelete(m)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>

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
          existingPlatforms={providers.map((p) => p.platform)}
        />
      </Modal>

      {/* Model 模态框 */}
      <Modal
        open={modelModal.open}
        onClose={() => setModelModal({ open: false })}
        title={modelModal.editing ? '编辑模型' : '添加模型'}
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

// ── 个人信息标签页 ──

function ProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  useEffect(() => {
    authApi.getMe()
      .then((user: UserResponse) => {
        setUsername(user.username);
        setEmail(user.email);
        setAvatarUrl(user.avatar_url ?? '');
      })
      .catch((err: unknown) => {
        toast.error(getErrorMessage(err, 'auth_update'));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: UserUpdateRequest = {
        username,
        email,
        avatar_url: avatarUrl,
      };
      await authApi.update(data);
      toast.success('个人信息已保存');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'settings_save'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-white font-display">个人信息</h2>
      <div className="rounded-xl border border-canvas-border bg-canvas-panel p-5 space-y-4">
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider">显示名称</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider">邮箱</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 focus:outline-none focus:border-neon-purple"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 uppercase tracking-wider">头像 URL</label>
          <input
            type="text"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="w-full mt-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-neon-purple"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Save className="w-4 h-4" />
        {saving ? '保存中...' : '保存修改'}
      </button>
    </div>
  );
}

// ── 存储用量标签页 ──

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

function StorageTab() {
  const [stats, setStats] = useState<StorageStatsResponse | null>(null);
  const [usage, setUsage] = useState<StorageUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      mediaApi.getStorageStats().then(setStats).catch(() => {}),
      mediaApi.getStorageUsage().then(setUsage).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">加载中...</p>;
  }

  const quotaBytes = stats?.quota_bytes ?? 10 * 1024 * 1024 * 1024;
  const usedBytes = stats?.used_bytes ?? 0;
  const fileCount = stats?.file_count ?? 0;
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
      <h2 className="text-lg font-medium text-white font-display">存储用量</h2>
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

// ═══════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');

  const tabs = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'ai', label: 'AI 配置', icon: Server },
    { id: 'storage', label: '存储用量', icon: HardDrive },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-white font-display mb-6">设置</h1>

        <div className="flex gap-6">
          {/* 侧边标签 */}
          <div className="w-40 flex-shrink-0 space-y-1">
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
          <div className="flex-1 min-w-0">
            {activeTab === 'profile' && <ProfileTab />}
            {activeTab === 'ai' && <AiConfigTab />}
            {activeTab === 'storage' && <StorageTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
