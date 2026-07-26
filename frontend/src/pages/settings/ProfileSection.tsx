// 个人信息标签页
// 从原 Settings.tsx ProfileTab（第 891-977 行）迁移
// 改造为受控组件：数据与刷新由父容器传入，本组件不再直接调用 API
import { useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';
import type { UserResponse, UserUpdateRequest } from '@/utils/apiClient';

interface ProfileSectionProps {
  user: UserResponse;
  onUpdate: (data: UserUpdateRequest) => Promise<void>;
}

export function ProfileSection({ user, onUpdate }: ProfileSectionProps) {
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: UserUpdateRequest = {
        username,
        email,
        avatar_url: avatarUrl,
      };
      await onUpdate(data);
      toast.success('个人信息已保存');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'settings_save'));
    } finally {
      setSaving(false);
    }
  };

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
