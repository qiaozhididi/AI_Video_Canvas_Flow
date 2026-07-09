import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/utils/apiClient';
import { toast } from 'sonner';
import { getErrorMessage } from '@/utils/errorMessages';
import { Sparkles, Loader2 } from 'lucide-react';

type Mode = 'login' | 'register';

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 已登录时自动跳转首页（含跨 Tab 同步）
  useEffect(() => {
    if (localStorage.getItem('access_token')) {
      navigate('/', { replace: true });
      return;
    }
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token' && e.newValue) {
        navigate('/', { replace: true });
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    try {
      setLoading(true);
      if (mode === 'register') {
        if (!email.trim()) {
          toast.error('请输入邮箱');
          return;
        }
        await authApi.register(username, email, password);
        toast.success('注册成功，请登录');
        setMode('login');
        return;
      }

      const tokens = await authApi.login(username, password);
      localStorage.setItem('access_token', tokens.access_token);
      localStorage.setItem('refresh_token', tokens.refresh_token);
      toast.success('登录成功');
      navigate('/');
    } catch (err) {
      toast.error(getErrorMessage(err, mode === 'login' ? 'auth_login' : 'auth_register'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-canvas-bg">
      <div className="w-full max-w-sm px-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center mb-4">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white font-display">AI Canvas Flow</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'login' ? '登录你的账号' : '创建新账号'}
          </p>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
              placeholder="请输入用户名"
              required
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
                placeholder="请输入邮箱"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-canvas-panel border border-canvas-border rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
              placeholder="请输入密码"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        {/* 切换登录/注册 */}
        <p className="text-center text-sm text-slate-500 mt-6">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-neon-purple hover:underline ml-1"
          >
            {mode === 'login' ? '立即注册' : '去登录'}
          </button>
        </p>
      </div>
    </div>
  );
}
