import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';

export interface MenuItem {
  label?: string;
  shortcut?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
}

interface ContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ visible, position, items, onClose }: ContextMenuProps) {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [submenuOpenIndex, setSubmenuOpenIndex] = useState<number>(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  // 关闭：点击外部 / Escape
  useEffect(() => {
    if (!visible) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose]);

  // 重置高亮
  useEffect(() => {
    if (visible) {
      setActiveIndex(-1);
      setSubmenuOpenIndex(-1);
    }
  }, [visible]);

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.disabled || item.separator || item.submenu) return;
      item.onClick?.();
      onClose();
    },
    [onClose],
  );

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const selectableIndices = items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => !item.disabled && !item.separator);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectableIndices.length === 0) return;
        const currentPos = selectableIndices.findIndex(({ idx }) => idx === activeIndex);
        const nextPos = currentPos === -1 ? 0 : (currentPos + 1) % selectableIndices.length;
        setActiveIndex(selectableIndices[nextPos].idx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectableIndices.length === 0) return;
        const currentPos = selectableIndices.findIndex(({ idx }) => idx === activeIndex);
        const prevPos = currentPos === -1 ? selectableIndices.length - 1 : (currentPos - 1 + selectableIndices.length) % selectableIndices.length;
        setActiveIndex(selectableIndices[prevPos].idx);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < items.length) {
          handleItemClick(items[activeIndex]);
        }
      } else if (e.key === 'ArrowRight') {
        if (activeIndex >= 0 && !items[activeIndex]?.disabled && items[activeIndex]?.submenu) {
          setSubmenuOpenIndex(activeIndex);
        }
      } else if (e.key === 'ArrowLeft') {
        setSubmenuOpenIndex(-1);
      }
    },
    [items, activeIndex, handleItemClick],
  );

  if (!visible) return null;

  // 边界检测：菜单宽度估算 200px，高度按 items 数 * 32px 估算
  const MENU_WIDTH = 200;
  const MENU_HEIGHT = items.length * 32;
  const adjustedX = Math.max(0, position.x + MENU_WIDTH > window.innerWidth ? position.x - MENU_WIDTH : position.x);
  const adjustedY = Math.max(0, position.y + MENU_HEIGHT > window.innerHeight ? position.y - MENU_HEIGHT : position.y);

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="fixed z-50 min-w-[200px] bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl py-1 focus:outline-none"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="h-px bg-canvas-border my-1" />;
        }
        const Icon = item.icon;
        const isActive = idx === activeIndex;
        const hasSubmenu = !!item.submenu;
        return (
          <div
            key={idx}
            role="menuitem"
            onMouseEnter={() => {
              setActiveIndex(idx);
              setSubmenuOpenIndex(hasSubmenu ? idx : -1);
            }}
            onClick={() => handleItemClick(item)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-default ${
              item.disabled
                ? 'text-slate-600 cursor-not-allowed'
                : isActive
                ? 'bg-canvas-hover text-white'
                : 'text-slate-300'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-slate-500">{item.shortcut}</span>
            )}
            {hasSubmenu && <ChevronRight className="w-3 h-3 text-slate-500" />}
            {hasSubmenu && submenuOpenIndex === idx && item.submenu && (
              <Submenu items={item.submenu} parentX={adjustedX} onClose={onClose} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// 子菜单组件（右展开，靠右边缘时左展开）
function Submenu({
  items,
  parentX,
  onClose,
}: {
  items: MenuItem[];
  parentX: number;
  onClose: () => void;
}) {
  const SUBMENU_WIDTH = 200;
  const openRight = parentX + SUBMENU_WIDTH * 2 < window.innerWidth;
  const handleSubClick = (item: MenuItem) => {
    if (item.disabled || item.separator || item.submenu) return;
    item.onClick?.();
    onClose();
  };
  return (
    <div
      role="menu"
      className="absolute top-0 min-w-[200px] bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl py-1"
      style={{ left: openRight ? '100%' : '-100%' }}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="h-px bg-canvas-border my-1" />;
        }
        const Icon = item.icon;
        return (
          <div
            key={idx}
            role="menuitem"
            onMouseEnter={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              handleSubClick(item);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-default ${
              item.disabled ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 hover:bg-canvas-hover hover:text-white'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[10px] text-slate-500">{item.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}
