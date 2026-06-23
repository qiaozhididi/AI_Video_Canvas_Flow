import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Monitor, Store, Settings,
  Sparkles,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: '工作台' },
  { path: '/media', icon: FolderOpen, label: '媒体库' },
  { path: '/render', icon: Monitor, label: '渲染中心' },
  { path: '/templates', icon: Store, label: '模板市场' },
  { path: '/settings', icon: Settings, label: '设置' },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="h-screen flex bg-canvas-bg">
      {/* 侧边导航 */}
      <nav className="w-16 bg-canvas-panel border-r border-canvas-border flex flex-col items-center py-4 gap-1">
        {/* Logo */}
        <Link to="/" className="mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
        </Link>

        {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
          const isActive = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                isActive
                  ? 'bg-neon-purple/20 text-neon-purple'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-canvas-hover'
              }`}
              title={label}
            >
              <Icon className="w-5 h-5" />
            </Link>
          );
        })}
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
