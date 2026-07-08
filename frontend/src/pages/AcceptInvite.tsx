import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invitationApi, type InvitationInfoResponse } from '@/utils/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { Mail, Loader2, CheckCircle, XCircle, LogIn } from 'lucide-react';

type PageState = 'loading' | 'loaded' | 'accepting' | 'accepted' | 'error';

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [state, setState] = useState<PageState>('loading');
  const [info, setInfo] = useState<InvitationInfoResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMsg('无效的邀请链接');
      setState('error');
      return;
    }
    invitationApi.getInfo(token)
      .then((data) => {
        setInfo(data);
        setState('loaded');
      })
      .catch((err: any) => {
        setErrorMsg(err?.message || '获取邀请信息失败');
        setState('error');
      });
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setState('accepting');
    try {
      const res = await invitationApi.accept(token);
      setState('accepted');
      toast.success(`已加入项目「${res.project_name}」`);
      setTimeout(() => navigate(`/editor/${res.project_id}`, { replace: true }), 1000);
    } catch (err: any) {
      toast.error(err?.message || '接受邀请失败');
      setState('loaded');
    }
  };

  const roleLabel = (role: string) => {
    switch (role) {
      case 'editor': return '编辑者';
      case 'viewer': return '查看者';
      case 'owner': return '所有者';
      default: return role;
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-canvas-bg">
      <div className="w-full max-w-md px-8">
        {state === 'loading' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 text-neon-purple animate-spin" />
            <p className="text-sm text-slate-400">加载邀请信息...</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-red-500/20 flex items-center justify-center">
              <XCircle className="w-7 h-7 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-white font-display">邀请无效</h1>
            <p className="text-sm text-slate-400 text-center">{errorMsg}</p>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-sm text-slate-300 bg-canvas-hover border border-canvas-border rounded-lg hover:border-neon-purple hover:text-white transition-colors"
            >
              返回首页
            </button>
          </div>
        )}

        {state === 'accepted' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-green-400" />
            </div>
            <h1 className="text-xl font-bold text-white font-display">已加入项目</h1>
            <p className="text-sm text-slate-400">正在跳转到编辑器...</p>
          </div>
        )}

        {(state === 'loaded' || state === 'accepting') && info && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center">
              <Mail className="w-7 h-7 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-white font-display">项目邀请</h1>
              <p className="text-sm text-slate-400 mt-1">你被邀请加入以下项目</p>
            </div>

            <div className="w-full bg-canvas-panel border border-canvas-border rounded-xl p-5 space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">项目名称</span>
                <span className="text-sm text-white">{info.project_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">邀请者</span>
                <span className="text-sm text-white">{info.created_by_username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">权限</span>
                <span className="text-sm text-neon-purple">{roleLabel(info.role)}</span>
              </div>
              {info.expires_at && (
                <div className="flex justify-between">
                  <span className="text-xs text-slate-500">过期时间</span>
                  <span className="text-sm text-slate-300">{new Date(info.expires_at).toLocaleString('zh-CN')}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">状态</span>
                {info.is_valid ? (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> 有效
                  </span>
                ) : (
                  <span className="text-xs text-red-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> 已失效
                  </span>
                )}
              </div>
            </div>

            {!info.is_valid ? (
              <p className="text-sm text-red-400">此邀请链接已失效或已使用</p>
            ) : !isAuthenticated ? (
              <div className="w-full space-y-3">
                <p className="text-sm text-slate-400 text-center">请先登录以接受邀请</p>
                <button
                  onClick={() => navigate('/login')}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity"
                >
                  <LogIn className="w-4 h-4" />
                  去登录
                </button>
              </div>
            ) : (
              <button
                onClick={handleAccept}
                disabled={state === 'accepting'}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {state === 'accepting' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                接受邀请
              </button>
            )}

            <button
              onClick={() => navigate('/')}
              className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              返回首页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
