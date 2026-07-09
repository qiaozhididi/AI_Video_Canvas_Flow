import { useState } from 'react';
import { X, Link, Copy, Loader2, Check } from 'lucide-react';
import { invitationApi } from '@/utils/apiClient';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';

interface InviteModalProps {
  projectId: string;
  onClose: () => void;
}

const ROLES = [
  { value: 'editor' as const, label: '编辑者' },
  { value: 'viewer' as const, label: '查看者' },
];

const EXPIRES_OPTIONS = [
  { value: 1, label: '1 小时' },
  { value: 24, label: '24 小时' },
  { value: 168, label: '7 天' },
  { value: 0, label: '永不过期' },
];

type Stage = 'idle' | 'creating' | 'created';

export default function InviteModal({ projectId, onClose }: InviteModalProps) {
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [expiresIn, setExpiresIn] = useState(24);
  const [stage, setStage] = useState<Stage>('idle');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setStage('creating');
    try {
      const res = await invitationApi.create(projectId, {
        role,
        expires_in_hours: expiresIn === 0 ? null : expiresIn,
      });
      const link = `${window.location.origin}/invite/${res.token}`;
      setInviteLink(link);
      setStage('created');
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'invite_create'));
      setStage('idle');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('链接已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && stage !== 'creating') onClose();
      }}
    >
      <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[420px] shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border">
          <div className="flex items-center gap-2">
            <Link className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-medium text-white font-display">邀请协作</h3>
          </div>
          <button
            onClick={onClose}
            disabled={stage === 'creating'}
            className="p-1 rounded hover:bg-canvas-hover text-slate-400 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5 space-y-4">
          {stage === 'idle' && (
            <>
              {/* 权限选择 */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 uppercase tracking-wider">权限</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                  className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 focus:outline-none focus:border-neon-purple"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* 有效期选择 */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-500 uppercase tracking-wider">有效期</label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 focus:outline-none focus:border-neon-purple"
                >
                  {EXPIRES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {stage === 'creating' && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 text-neon-purple animate-spin" />
              <span className="text-sm text-slate-300 ml-2">生成邀请链接中...</span>
            </div>
          )}

          {stage === 'created' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">邀请链接已生成：</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 focus:outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-canvas-border">
          <button
            onClick={onClose}
            disabled={stage === 'creating'}
            className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50"
          >
            {stage === 'created' ? '关闭' : '取消'}
          </button>
          {stage === 'idle' && (
            <button
              onClick={handleCreate}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
            >
              <Link className="w-3.5 h-3.5" />
              生成邀请链接
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
