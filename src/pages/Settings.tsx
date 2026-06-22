import { useState } from 'react';
import { User, Key, HardDrive, CreditCard, Save } from 'lucide-react';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [displayName, setDisplayName] = useState('用户');
  const [email, setEmail] = useState('user@example.com');

  const tabs = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'api', label: 'API 配置', icon: Key },
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
