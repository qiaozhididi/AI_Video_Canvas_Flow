import { useStore, useViewport } from '@xyflow/react';
import {
  AlignStartVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignCenterVertical,
  AlignCenterHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignHorizontalCenter,
  alignVerticalCenter,
  distributeHorizontal,
  distributeVertical,
} from '@/utils/alignment';

type AlignFn = typeof alignLeft;

interface AlignButton {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  fn: AlignFn;
  minNodes: number;
}

const ALIGN_BUTTONS: AlignButton[] = [
  { icon: AlignStartVertical, title: '左对齐', fn: alignLeft, minNodes: 2 },
  { icon: AlignEndVertical, title: '右对齐', fn: alignRight, minNodes: 2 },
  { icon: AlignCenterVertical, title: '垂直居中', fn: alignVerticalCenter, minNodes: 2 },
  { icon: AlignStartHorizontal, title: '顶对齐', fn: alignTop, minNodes: 2 },
  { icon: AlignEndHorizontal, title: '底对齐', fn: alignBottom, minNodes: 2 },
  { icon: AlignCenterHorizontal, title: '水平居中', fn: alignHorizontalCenter, minNodes: 2 },
  { icon: AlignHorizontalDistributeCenter, title: '水平等距', fn: distributeHorizontal, minNodes: 3 },
  { icon: AlignVerticalDistributeCenter, title: '垂直等距', fn: distributeVertical, minNodes: 3 },
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
        const isDisabled = selectedNodes.length < btn.minNodes;
        return (
          <button
            key={idx}
            onClick={() => !isDisabled && handleAlign(btn.fn)}
            disabled={isDisabled}
            title={btn.title}
            className="p-1.5 rounded hover:bg-canvas-hover text-slate-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
