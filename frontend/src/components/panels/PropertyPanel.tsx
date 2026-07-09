import { useCanvasStore } from '@/stores/canvasStore';
import { NODE_CATEGORIES, type CanvasNodeData, type ProcessingSubtype, type ControlSubtype } from '@/types/canvas';
import { X, Trash2, Play } from 'lucide-react';
import { executeNode } from '../../utils/workflowExecutor';
import { getErrorMessage } from '@/utils/errorMessages';

export default function PropertyPanel() {
  const { nodes, selectedNodeId, updateNodeData, removeNode, setNodeStatus, setNodeError } = useCanvasStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) {
    return (
      <div className="w-72 h-full bg-canvas-panel border-l border-canvas-border flex items-center justify-center">
        <p className="text-sm text-slate-500">选择节点查看属性</p>
      </div>
    );
  }

  const data = selectedNode.data;
  const category = NODE_CATEGORIES[data.type];

  const handleParamChange = (key: string, value: unknown) => {
    updateNodeData(selectedNode.id, {
      params: { ...data.params, [key]: value },
    });
  };

  const renderParamField = (key: string, value: unknown) => {
    if (typeof value === 'string') {
      if (key.includes('text') || key.includes('prompt') || key.includes('condition')) {
        return (
          <textarea
            value={value}
            onChange={(e) => handleParamChange(key, e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple resize-none"
          />
        );
      }
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => handleParamChange(key, e.target.value)}
          className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
        />
      );
    }

    if (typeof value === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleParamChange(key, Number(e.target.value))}
          className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
        />
      );
    }

    if (typeof value === 'boolean') {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => handleParamChange(key, e.target.checked)}
            className="w-4 h-4 rounded border-canvas-border bg-canvas-bg text-neon-purple focus:ring-neon-purple"
          />
          <span className="text-sm text-slate-400">{key}</span>
        </label>
      );
    }

    return (
      <input
        type="text"
        value={String(value)}
        onChange={(e) => handleParamChange(key, e.target.value)}
        className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
      />
    );
  };

  return (
    <div className="w-72 h-full bg-canvas-panel border-l border-canvas-border flex flex-col">
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-canvas-border"
        style={{ backgroundColor: category.color + '15' }}
      >
        <h3 className="text-sm font-medium text-slate-200 font-display">
          {data.label}
        </h3>
        <button
          onClick={() => useCanvasStore.getState().setSelectedNode(null)}
          className="p-1 rounded hover:bg-canvas-hover transition-colors"
        >
          <X className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>

      {/* 属性内容 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 节点信息 */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-500 uppercase tracking-wider">标签</label>
          <input
            type="text"
            value={data.label}
            onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
          />
        </div>

        {/* 参数 */}
        <div className="space-y-2">
          <label className="text-xs text-slate-500 uppercase tracking-wider">参数</label>
          {Object.entries(data.params).map(([key, value]) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-slate-400 capitalize">{key}</label>
              {renderParamField(key, value)}
            </div>
          ))}
        </div>

        {/* 控制节点不可执行提示 */}
        {data.type === 'control' && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex-shrink-0 mt-0.5">控制</span>
            <p className="text-xs text-purple-300/80">此节点用于工作流逻辑控制，不可单独执行</p>
          </div>
        )}

        {/* 状态信息 */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-500 uppercase tracking-wider">状态</label>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                data.status === 'running' ? 'bg-status-running animate-pulse' :
                data.status === 'completed' ? 'bg-status-success' :
                data.status === 'failed' ? 'bg-status-error' :
                data.status === 'pending' ? 'bg-status-warning' :
                'bg-slate-600'
              }`}
            />
            <span className="text-sm text-slate-300 capitalize">{data.status}</span>
          </div>
          {data.status === 'running' && (
            <div className="w-full h-1.5 bg-canvas-border rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-neon-purple to-neon-blue transition-all"
                style={{ width: `${data.progress}%` }}
              />
            </div>
          )}
        </div>

        {/* 输出资产 */}
        {data.outputArtifacts.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">输出</label>
            {data.outputArtifacts.map((artifact) => (
              <div key={artifact.id} className="flex items-center gap-2 px-2 py-1 bg-canvas-bg rounded-md">
                <span className="text-xs text-slate-400">{artifact.type}</span>
                <span className="text-xs text-slate-300 truncate">{artifact.filename}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="p-3 border-t border-canvas-border space-y-2">
        {data.type !== 'control' && data.type !== 'input' && (
          <button
            onClick={async () => {
              try {
                setNodeStatus(selectedNode.id, 'pending', 0);
                await executeNode(selectedNode.id);
              } catch (err: any) {
                setNodeStatus(selectedNode.id, 'failed', 0);
                setNodeError(selectedNode.id, getErrorMessage(err, 'node_execute'));
              }
            }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
          >
            <Play className="w-3.5 h-3.5" />
            执行节点
          </button>
        )}
        <button
          onClick={() => removeNode(selectedNode.id)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除节点
        </button>
      </div>
    </div>
  );
}
