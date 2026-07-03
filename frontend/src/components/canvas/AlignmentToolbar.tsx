import { useStore, useViewport } from '@xyflow/react';
import {
  AlignStartVertical,
  AlignStartHorizontal,
  AlignCenterVertical,
  AlignCenterHorizontal,
} from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  alignLeft,
  alignTop,
  alignHorizontalCenter,
  alignVerticalCenter,
} from '@/utils/alignment';

type AlignFn = typeof alignLeft;

interface AlignButton {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  fn: AlignFn;
}

const ALIGN_BUTTONS: AlignButton[] = [
  { icon: AlignStartVertical, title: '左对齐', fn: alignLeft },
  { icon: AlignCenterVertical, title: '垂直居中', fn: alignVerticalCenter },
  { icon: AlignStartHorizontal, title: '顶对齐', fn: alignTop },
  { icon: AlignCenterHorizontal, title: '水平居中', fn: alignHorizontalCenter },
];

export default function AlignmentToolbar() {
  // 从 React Flow 内部状态读取选中节点和 viewport
  const selectedNodes = useStore((state) => state.nodes.filter((n) => n.selected));
  const { x, y, zoom } = useViewport();
  const alignNodes = useCanvasStore((s) => s.alignNodes);

  if (selectedNodes.length < 2) return null;

  // 计算 bounding box（节点坐标）
  const xs = selectedNodes.map((n) => n.position.x);
  const ys = selectedNodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  // 转换为屏幕坐标（React Flow viewport transform）
  const centerX = ((minX + maxX) / 2) * zoom + x;
  const bottomY = (maxY + 50) * zoom + y;

  const handleAlign = (fn: AlignFn) => {
    const positionableNodes = selectedNodes.map((n) => ({
      id: n.id,
      position: n.position,
      width: n.measured?.width,
      height: n.measured?.height,
    }));
    const updates = fn(positionableNodes);
    alignNodes(updates);
  };

  return (
    <div
      className="absolute z-20 flex items-center gap-0.5 px-1.5 py-1 bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl"
      style={{
        left: centerX,
        top: bottomY,
        transform: 'translateX(-50%)',
      }}
    >
      {ALIGN_BUTTONS.map((btn, idx) => {
        const Icon = btn.icon;
        return (
          <button
            key={idx}
            onClick={() => handleAlign(btn.fn)}
            title={btn.title}
            className="p-1.5 rounded hover:bg-canvas-hover text-slate-300 hover:text-white transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
