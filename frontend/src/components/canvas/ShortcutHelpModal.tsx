import { X, Keyboard } from 'lucide-react';

interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string;
  desc: string;
}

const GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: '通用',
    items: [
      { keys: 'Ctrl/⌘ + Z', desc: '撤销' },
      { keys: 'Ctrl/⌘ + Shift + Z', desc: '重做' },
      { keys: 'Ctrl/⌘ + S', desc: '保存项目' },
      { keys: 'Ctrl/⌘ + /', desc: '打开快捷键面板' },
    ],
  },
  {
    title: '节点操作',
    items: [
      { keys: 'Ctrl/⌘ + C', desc: '复制选中节点' },
      { keys: 'Ctrl/⌘ + V', desc: '粘贴节点' },
      { keys: 'Ctrl/⌘ + A', desc: '全选节点' },
      { keys: 'Delete / Backspace', desc: '删除选中节点' },
      { keys: 'F2', desc: '重命名选中节点' },
      { keys: 'F5', desc: '执行选中节点' },
      { keys: 'Escape', desc: '取消选中 / 关闭面板' },
    ],
  },
  {
    title: '视图',
    items: [
      { keys: '右键节点', desc: '节点上下文菜单' },
      { keys: '右键画布', desc: '画布上下文菜单' },
      { keys: '双击节点标题', desc: '进入重命名' },
    ],
  },
];

export default function ShortcutHelpModal({ open, onClose }: ShortcutHelpModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[480px] shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-medium text-white font-display">快捷键</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-canvas-hover text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区：分组列表 */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider">{group.title}</h4>
              <div className="space-y-0.5">
                {group.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1">
                    <span className="text-sm text-slate-300">{item.desc}</span>
                    <kbd className="px-2 py-0.5 text-[11px] bg-canvas-bg border border-canvas-border rounded text-slate-400 font-mono">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
