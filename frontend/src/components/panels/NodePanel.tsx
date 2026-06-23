import { useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { NODE_TEMPLATES, NODE_CATEGORIES, type NodeSubtype } from '@/types/canvas';
import { Search, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import type { NodeType } from '@/types/canvas';

export default function NodePanel() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(NODE_CATEGORIES).map((k) => [k, true]))
  );
  const addNode = useCanvasStore((s) => s.addNode);
  const pushAddNode = useHistoryStore((s) => s.pushAddNode);
  const markDirty = useAutoSaveStore((s) => s.markDirty);

  const handleAddNode = (subtype: NodeSubtype, position: { x: number; y: number }) => {
    addNode(subtype, position);
    // 记录到 historyStore
    const newNode = useCanvasStore.getState().nodes[useCanvasStore.getState().nodes.length - 1];
    if (newNode) {
      pushAddNode({ node: newNode });
    }
    markDirty();
  };

  const filtered = NODE_TEMPLATES.filter((t) =>
    t.label.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = Object.entries(NODE_CATEGORIES).map(([type, meta]) => ({
    type: type as NodeType,
    ...meta,
    templates: filtered.filter((t) => t.type === type),
  })).filter((g) => g.templates.length > 0);

  const handleDragStart = (e: React.DragEvent, subtype: NodeSubtype) => {
    e.dataTransfer.setData('application/reactflow-subtype', subtype);
    e.dataTransfer.effectAllowed = 'move';
  };

  const toggleExpand = (type: string) => {
    setExpanded((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="w-60 h-full bg-canvas-panel border-r border-canvas-border flex flex-col">
      {/* 搜索框 */}
      <div className="p-3 border-b border-canvas-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="搜索节点..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple"
          />
        </div>
      </div>

      {/* 节点列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {grouped.map(({ type, label, color, templates }) => (
          <div key={type}>
            <button
              onClick={() => toggleExpand(type)}
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              {expanded[type] ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {label}
              <span className="ml-auto text-slate-600">{templates.length}</span>
            </button>

            {expanded[type] && (
              <div className="space-y-0.5 pl-1">
                {templates.map((template) => (
                  <div
                    key={template.subtype}
                    draggable
                    onDragStart={(e) => handleDragStart(e, template.subtype)}
                    onClick={() => handleAddNode(template.subtype, { x: 250, y: 250 })}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab hover:bg-canvas-hover transition-colors group"
                  >
                    <GripVertical className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
                    <span className="text-sm text-slate-300">{template.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
