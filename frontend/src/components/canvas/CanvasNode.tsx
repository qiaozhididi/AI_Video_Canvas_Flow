import { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, type Node } from '@xyflow/react';
import type { CanvasNodeData } from '@/types/canvas';
import { NODE_CATEGORIES } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  Type, Image, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
  Loader2, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Type, Image, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  idle: () => null,
  pending: Loader2,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

type CanvasNodeProps = { data: CanvasNodeData; selected: boolean; id: string };

function CanvasNodeComponent({ data, selected, id }: CanvasNodeProps) {
  const category = NODE_CATEGORIES[data.type];
  const IconComponent = ICON_MAP[data.subtype] || AlertCircle;
  const StatusIcon = STATUS_ICONS[data.status];
  const editingNodeId = useCanvasStore((s) => s.editingNodeId);
  const setEditingNodeId = useCanvasStore((s) => s.setEditingNodeId);
  const renameNode = useCanvasStore((s) => s.renameNode);
  const isEditing = editingNodeId === id;

  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入编辑态时聚焦并全选
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      setEditValue(data.label);
    }
  }, [isEditing, data.label]);

  const commitRename = () => {
    renameNode(id, editValue);
    setEditingNodeId(null);
  };

  const cancelRename = () => {
    setEditingNodeId(null);
  };

  const borderColor = data.status === 'running'
    ? 'border-status-running animate-pulse-neon'
    : data.status === 'completed'
    ? 'border-status-success'
    : data.status === 'failed'
    ? 'border-status-error'
    : selected
    ? 'border-neon-purple'
    : 'border-canvas-border';

  return (
    <div
      className={`
        min-w-[180px] rounded-lg border-2 bg-canvas-panel
        shadow-lg transition-all duration-200
        ${borderColor}
        ${selected ? 'shadow-neon-purple/20' : ''}
      `}
    >
      {/* 输入端口 */}
      {data.type !== 'input' && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !border-2 !border-neon-purple !bg-canvas-panel"
        />
      )}

      {/* 节点头部 */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-md"
        style={{ backgroundColor: category.color + '20' }}
      >
        <div
          className="flex items-center justify-center w-7 h-7 rounded-md"
          style={{ backgroundColor: category.color + '30' }}
        >
          <IconComponent className="w-4 h-4" style={{ color: category.color }} />
        </div>
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
            className="flex-1 min-w-0 px-1 py-0 text-sm font-medium text-slate-200 font-display bg-canvas-bg border border-neon-purple rounded focus:outline-none"
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-sm font-medium text-slate-200 font-display"
            onDoubleClick={() => setEditingNodeId(id)}
            title={data.label}
          >
            {data.label}
          </span>
        )}
        {StatusIcon && (
          <StatusIcon
            className={`w-4 h-4 ml-auto ${
              data.status === 'running' ? 'animate-spin text-status-running' :
              data.status === 'completed' ? 'text-status-success' :
              data.status === 'failed' ? 'text-status-error' :
              'text-status-warning'
            }`}
          />
        )}
      </div>

      {/* 进度条 */}
      {data.status === 'running' && (
        <div className="h-1 bg-canvas-border">
          <div
            className="h-full bg-gradient-to-r from-neon-purple to-neon-blue transition-all duration-300"
            style={{ width: `${data.progress}%` }}
          />
        </div>
      )}

      {/* 节点内容 */}
      <div className="px-3 py-2 space-y-1">
        {data.error && (
          <p className="text-xs text-status-error truncate" title={data.error}>
            {data.error}
          </p>
        )}
        {data.outputArtifacts.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {data.outputArtifacts.slice(0, 3).map((artifact) => (
              <span
                key={artifact.id}
                className="text-[10px] px-1.5 py-0.5 rounded bg-canvas-hover text-slate-400"
              >
                {artifact.type}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 输出端口 */}
      {data.type !== 'output' && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !border-2 !border-neon-purple !bg-canvas-panel"
        />
      )}
    </div>
  );
}

export default memo(CanvasNodeComponent);
