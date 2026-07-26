// Settings 容器组件
// 拆分后：仅负责数据加载与分发到 settings/ 下各子组件
// 原始 Settings.tsx（1114 行）已拆分为 5 个 Section + Modal + constants
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authApi, mediaApi, aiApi } from '@/utils/apiClient';
import { getErrorMessage } from '@/utils/errorMessages';
import type {
  UserResponse,
  UserUpdateRequest,
  AiProviderResponse,
  AiProviderCreateRequest,
  AiProviderUpdateRequest,
  AiModelResponse,
  AiModelCreateRequest,
  AiModelUpdateRequest,
  StorageStatsResponse,
  StorageUsageResponse,
} from '@/utils/apiClient';
import { ProfileSection } from './settings/ProfileSection';
import { StorageSection } from './settings/StorageSection';
import { AiProviderSection } from './settings/AiProviderSection';
import { AiModelSection } from './settings/AiModelSection';

type Tab = 'profile' | 'storage' | 'ai_provider' | 'ai_model';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: '个人信息' },
  { id: 'storage', label: '存储空间' },
  { id: 'ai_provider', label: 'AI 服务商' },
  { id: 'ai_model', label: 'AI 模型' },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('profile');
  const [user, setUser] = useState<UserResponse | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [providers, setProviders] = useState<AiProviderResponse[]>([]);
  const [models, setModels] = useState<AiModelResponse[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [storageStats, setStorageStats] = useState<StorageStatsResponse | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsageResponse | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);

  useEffect(() => {
    authApi
      .getMe()
      .then(setUser)
      .catch((err) => toast.error(getErrorMessage(err, 'auth_update')))
      .finally(() => setUserLoading(false));

    Promise.allSettled([refreshProviders(), refreshModels()]).finally(() =>
      setAiLoading(false),
    );

    refreshStorage();
  }, []);

  const refreshProviders = async () => {
    try { setProviders(await aiApi.providers.list()); } catch {}
  };
  const refreshModels = async () => {
    try { setModels(await aiApi.models.list()); } catch {}
  };
  const refreshStorage = async () => {
    setStorageLoading(true);
    try {
      const [stats, usage] = await Promise.all([
        mediaApi.getStorageStats().catch(() => null),
        mediaApi.getStorageUsage().catch(() => null),
      ]);
      setStorageStats(stats);
      setStorageUsage(usage);
    } finally {
      setStorageLoading(false);
    }
  };

  const handleUserUpdate = async (data: UserUpdateRequest) => {
    const updated = await authApi.update(data);
    setUser(updated);
  };

  const handleProviderCreate = async (data: AiProviderCreateRequest) => {
    await aiApi.providers.create(data);
    await refreshProviders();
  };
  const handleProviderUpdate = async (id: string, data: AiProviderUpdateRequest) => {
    await aiApi.providers.update(id, data);
    await refreshProviders();
  };
  const handleProviderDelete = async (id: string) => {
    await aiApi.providers.delete(id);
    await Promise.all([refreshProviders(), refreshModels()]);
  };

  const handleModelCreate = async (data: AiModelCreateRequest) => {
    await aiApi.models.create(data);
    await refreshModels();
  };
  const handleModelUpdate = async (id: string, data: AiModelUpdateRequest) => {
    await aiApi.models.update(id, data);
    await refreshModels();
  };
  const handleModelDelete = async (id: string) => {
    await aiApi.models.delete(id);
    await refreshModels();
  };
  const handleModelSetDefault = async (id: string, _modelType: string) => {
    await aiApi.models.update(id, { is_default: true });
    await refreshModels();
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas-bg">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-xl font-medium text-slate-200 mb-6 font-display">设置</h1>

        <div className="flex gap-1 mb-6 border-b border-canvas-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm transition-colors ${
                tab === t.id
                  ? 'text-neon-purple border-b-2 border-neon-purple'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'profile' &&
          (userLoading ? (
            <p className="text-sm text-slate-500">加载中...</p>
          ) : user ? (
            <ProfileSection user={user} onUpdate={handleUserUpdate} />
          ) : (
            <p className="text-sm text-slate-500">加载用户信息失败，请刷新页面重试</p>
          ))}
        {tab === 'storage' && (
          <StorageSection
            stats={storageStats}
            usage={storageUsage}
            loading={storageLoading}
            onRefresh={refreshStorage}
          />
        )}
        {tab === 'ai_provider' &&
          (aiLoading ? (
            <p className="text-sm text-slate-500">加载中...</p>
          ) : (
            <AiProviderSection
              providers={providers}
              models={models}
              onCreate={handleProviderCreate}
              onUpdate={handleProviderUpdate}
              onDelete={handleProviderDelete}
            />
          ))}
        {tab === 'ai_model' &&
          (aiLoading ? (
            <p className="text-sm text-slate-500">加载中...</p>
          ) : (
            <AiModelSection
              models={models}
              providers={providers}
              onCreate={handleModelCreate}
              onUpdate={handleModelUpdate}
              onDelete={handleModelDelete}
              onSetDefault={handleModelSetDefault}
            />
          ))}
      </div>
    </div>
  );
}
