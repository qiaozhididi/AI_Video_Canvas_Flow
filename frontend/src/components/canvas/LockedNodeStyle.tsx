import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

interface LockedNodeData {
  label: string;
  _locked?: boolean;
  _lockHolder?: string | null;
  [key: string]: unknown;
}

/** 节点样式：根据 _locked 状态切换橙色边框 + 锁角标 */
const LockedNode = memo(({ data, selected }: NodeProps<Node<LockedNodeData>>) => {
  const isLocked = data._locked;
  return (
    <div
      className={[
        'relative rounded-lg border-2 px-3 py-2 transition-colors',
        isLocked
          ? 'border-orange-400 bg-orange-50 cursor-not-allowed'
          : selected
            ? 'border-blue-500 bg-white'
            : 'border-gray-300 bg-white',
      ].join(' ')}
    >
      {isLocked && (
        <div className="absolute -top-2 -right-2 flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white shadow">
          <span>🔒</span>
          <span className="max-w-[80px] truncate">{data._lockHolder}</span>
        </div>
      )}
      <div className="text-sm font-medium">{data.label}</div>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export default LockedNode;
