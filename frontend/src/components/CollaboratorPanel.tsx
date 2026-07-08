import { useState, useEffect } from 'react';
import { X, UserPlus, Shield, Pencil, Eye, Trash2 } from 'lucide-react';
import { collabApi, type CollaboratorResponse } from '@/utils/apiClient';
import { useAuthStore } from '@/stores/authStore';
import InviteModal from './InviteModal';
import { toast } from 'sonner';

interface CollaboratorPanelProps {
  projectId: string;
  isOwner: boolean;
  onClose: () => void;
}

const ROLE_CONFIG = {
  owner: { label: '所有者', icon: Shield, color: 'text-amber-400' },
  editor: { label: '编辑者', icon: Pencil, color: 'text-neon-purple' },
  viewer: { label: '查看者', icon: Eye, color: 'text-slate-400' },
} as const;

export default function CollaboratorPanel({ projectId, isOwner, onClose }: CollaboratorPanelProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [collaborators, setCollaborators] = useState<CollaboratorResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    collabApi.list(projectId)
      .then(setCollaborators)
      .catch(() => toast.error('加载协作者失败'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleRemove = async (userId: string, username: string) => {
    try {
      await collabApi.remove(projectId, userId);
      setCollaborators((prev) => prev.filter((c) => c.user_id !== userId));
      toast.success(`已移除 ${username}`);
    } catch (err: any) {
      toast.error(err?.message || '移除失败');
    }
  };

  const handleChangeRole = async (userId: string, newRole: string, username: string) => {
    try {
      await collabApi.updateRole(projectId, userId, newRole);
      setCollaborators((prev) =>
        prev.map((c) => (c.user_id === userId ? { ...c, role: newRole as CollaboratorResponse['role'] } : c)),
      );
      toast.success(`已将 ${username} 设为${ROLE_CONFIG[newRole as keyof typeof ROLE_CONFIG]?.label || newRole}`);
    } catch (err: any) {
      toast.error(err?.message || '修改权限失败');
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[420px] max-h-[80vh] shadow-2xl flex flex-col">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-neon-purple" />
              <h3 className="text-sm font-medium text-white font-display">协作者</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-canvas-hover text-slate-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 协作者列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading ? (
              <p className="text-sm text-slate-500 text-center py-4">加载中...</p>
            ) : collaborators.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">暂无协作者</p>
            ) : (
              collaborators.map((c) => {
                const roleKey = c.role as keyof typeof ROLE_CONFIG;
                const roleConf = ROLE_CONFIG[roleKey] || ROLE_CONFIG.viewer;
                const RoleIcon = roleConf.icon;
                const isSelf = c.user_id === currentUser?.id;
                const isOwnerRow = c.role === 'owner';

                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-canvas-hover transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-canvas-border flex items-center justify-center text-xs font-medium text-slate-300">
                      {c.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">
                        {c.username}{isSelf ? ' (你)' : ''}
                      </p>
                    </div>
                    <span className={`flex items-center gap-1 text-xs ${roleConf.color}`}>
                      <RoleIcon className="w-3 h-3" />
                      {roleConf.label}
                    </span>
                    {isOwner && !isOwnerRow && (
                      <div className="flex items-center gap-1">
                        <select
                          value={c.role}
                          onChange={(e) => handleChangeRole(c.user_id, e.target.value, c.username)}
                          className="text-xs bg-canvas-bg border border-canvas-border rounded px-1 py-0.5 text-slate-300 focus:outline-none focus:border-neon-purple"
                        >
                          <option value="editor">编辑者</option>
                          <option value="viewer">查看者</option>
                        </select>
                        <button
                          onClick={() => handleRemove(c.user_id, c.username)}
                          className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                          title="移除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 底部：邀请按钮（仅 owner 可见） */}
          {isOwner && (
            <div className="px-5 py-3 border-t border-canvas-border">
              <button
                onClick={() => setShowInvite(true)}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
              >
                <UserPlus className="w-3.5 h-3.5" />
                邀请协作者
              </button>
            </div>
          )}
        </div>
      </div>

      {showInvite && (
        <InviteModal
          projectId={projectId}
          onClose={() => setShowInvite(false)}
        />
      )}
    </>
  );
}
