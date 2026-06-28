import { useMemo } from 'react';
import { useViewport } from '@xyflow/react';
import { MousePointer2 } from 'lucide-react';
import { useCollabStore, type RemoteCursor } from '@/stores/collabStore';

// 固定调色板，按 user_id hash 取色，保证同用户颜色稳定
const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

function colorFor(userId: string): string {
  if (!userId) return COLORS[0];
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLORS[h % COLORS.length];
}

export default function RemoteCursors() {
  const remoteCursors = useCollabStore((s) => s.remoteCursors);
  const { x, y, zoom } = useViewport();

  const decorated = useMemo(
    () =>
      remoteCursors.map((c: RemoteCursor) => ({
        ...c,
        color: colorFor(c.user_id),
      })),
    [remoteCursors]
  );

  if (remoteCursors.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      {decorated.map((c) => (
        <div
          key={c.sid}
          className="absolute"
          style={{ left: c.x, top: c.y }}
        >
          <MousePointer2
            size={18}
            className="drop-shadow"
            style={{ color: c.color, fill: c.color }}
          />
          <span
            className="absolute left-3 top-3 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: c.color }}
          >
            {c.username || '匿名'}
          </span>
        </div>
      ))}
    </div>
  );
}
