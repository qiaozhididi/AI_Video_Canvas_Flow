import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  ConnectionLineType,
  SelectionMode,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useCollabStore } from '@/stores/collabStore';
import { executeNode, isExecutable } from '@/utils/workflowExecutor';
import {
  alignLeft, alignTop,
  alignHorizontalCenter, alignVerticalCenter,
} from '@/utils/alignment';
import CanvasNodeComponent from './CanvasNode';
import RemoteCursors from './RemoteCursors';
import AlignmentToolbar from './AlignmentToolbar';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { useContextMenu } from '@/hooks/useContextMenu';
import {
  Copy, ClipboardPaste, Pencil, Play, Trash2,
  AlignStartVertical, AlignStartHorizontal,
  AlignCenterVertical, AlignCenterHorizontal,
  Type, Image as ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge, Film, ImageDown, Volume2,
} from 'lucide-react';
import { NODE_TEMPLATES, NODE_CATEGORIES, type NodeSubtype, type CanvasNodeData } from '@/types/canvas';
import { toast } from 'sonner';

// 节点模板图标映射（与 CanvasNode.tsx 的 ICON_MAP 一致）
const ICON_MAP_LUCIDE: Record<string, React.ComponentType<{ className?: string }>> = {
  Type, Image: ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
};

const nodeTypes = { canvasNode: CanvasNodeComponent };

export default function Canvas() {
  const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode, fitViewToken, selectedNodeIds, setSelectedNodeIds } = useCanvasStore();
  const pushAddNode = useHistoryStore((s) => s.pushAddNode);
  const markDirty = useAutoSaveStore((s) => s.markDirty);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const { menuState, openNodeMenu, openPaneMenu, closeMenu } = useContextMenu();
  const removeNodes = useCanvasStore((s) => s.removeNodes);
  const setEditingNodeId = useCanvasStore((s) => s.setEditingNodeId);

  // 将 store 中的 CanvasNode 映射为 ReactFlow Node，保留 React Flow 内部状态
  // selected 由 selectedNodeIds 派生（单一事实来源）：框选 onSelectionChange 与 Ctrl+A selectAll 均通过 selectedNodeIds 驱动 React Flow 视觉高亮
  const reactFlowNodes: Node[] = useMemo(
    () => nodes.map((n) => ({
      id: n.id,
      type: 'canvasNode' as const,
      position: n.position,
      data: { ...n.data } as Record<string, unknown>,
      measured: n.measured,
      selected: selectedNodeIds.includes(n.id),
    })),
    [nodes, selectedNodeIds]
  );

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // 拦截键盘删除（Backspace/Delete）：使用 removeNodes 写入历史 + markDirty，
      // 而非 React Flow 默认的 applyNodeChanges → setNodes（不写历史、不触发保存）
      const removeChanges = changes.filter((c) => c.type === 'remove');
      if (removeChanges.length > 0) {
        const removeIds = removeChanges.map((c) => c.id);
        removeNodes(removeIds);
      }

      // 过滤掉 remove 变更，只处理其余变更（position/select/dimensions 等）
      const nonRemoveChanges = changes.filter((c) => c.type !== 'remove');
      if (nonRemoveChanges.length === 0) return;

      const updated = applyNodeChanges(nonRemoveChanges, reactFlowNodes);
      setNodes(
        updated.map((n) => ({
          id: n.id,
          type: (n.data as unknown as CanvasNodeData).type,
          position: n.position,
          data: n.data as unknown as CanvasNodeData,
          measured: n.measured,
        }))
      );

      // 协作广播：拖动结束广播节点 update。
      // 拖动中（dragging=true）不广播，避免高频。applyRemote 走 store set() 直接改 state，
      // 不经过此回调（仅 React Flow 内部交互触发），故无回环。
      const projectId = useCollabStore.getState().currentProjectId;
      if (!projectId) return;
      for (const change of nonRemoveChanges) {
        if (change.type === 'position' && change.dragging === false) {
          const node = updated.find((n) => n.id === change.id);
          if (node) {
            useCollabStore.getState().emitNodeUpdate({
              project_id: projectId,
              node_id: node.id,
              action: 'update',
              node: {
                id: node.id,
                type: (node.data as unknown as CanvasNodeData).type,
                position: node.position,
                data: node.data as unknown as CanvasNodeData,
                measured: node.measured,
              },
            });
          }
        }
      }
    },
    [reactFlowNodes, setNodes, removeNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // 拦截键盘删除 Edge：使用 removeEdge 写入历史 + markDirty
      const removeChanges = changes.filter((c) => c.type === 'remove');
      if (removeChanges.length > 0) {
        for (const c of removeChanges) {
          useCanvasStore.getState().removeEdge(c.id);
        }
      }

      const nonRemoveChanges = changes.filter((c) => c.type !== 'remove');
      if (nonRemoveChanges.length === 0) return;

      const updated = applyEdgeChanges(nonRemoveChanges, edges as Edge[]);
      setEdges(updated);
    },
    [edges, setEdges]
  );

  const onConnect: OnConnect = useCallback((connection) => {
    // 校验：拒绝自连接
    if (connection.source === connection.target) return;
    // 校验：拒绝重复边
    const exists = useCanvasStore.getState().edges.some(
      (e) => e.source === connection.source && e.target === connection.target
        && e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle
    );
    if (exists) return;

    // 用 canvasStore.addEdge（已实现广播），而非 xyflow addEdge + setEdges（不广播）
    useCanvasStore.getState().addEdge({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'smoothstep',
      animated: true,
    });
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    closeMenu();
  }, [setSelectedNode, closeMenu]);

  // 鼠标移动 → 转换为画布坐标 → 广播本地光标（50ms 节流已在 collabStore.emitCursorMove 内实现）
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!reactFlowInstance.current) return;
    const position = reactFlowInstance.current.screenToFlowPosition({
      x: e.clientX,
      y: e.clientY,
    });
    useCollabStore.getState().emitCursorMove(position.x, position.y);
  }, []);

  // ReactFlow 拖拽放置
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const subtype = e.dataTransfer.getData('application/reactflow-subtype') as NodeSubtype;
      if (!subtype) return;

      // 使用 reactFlowInstance 将鼠标屏幕坐标转换为画布流坐标
      const position = reactFlowInstance.current
        ? reactFlowInstance.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        : { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 };

      addNode(subtype, position);

      // 记录到 historyStore
      const newNode = useCanvasStore.getState().nodes[useCanvasStore.getState().nodes.length - 1];
      if (newNode) {
        pushAddNode({ node: newNode });
      }
      markDirty();
    },
    [addNode, pushAddNode, markDirty]
  );

  // 选中状态同步到 store（供 EditorLayout 复制使用）
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selected }) => {
    setSelectedNodeIds(selected.map((n) => n.id));
  }, [setSelectedNodeIds]);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      // 右键未选中节点 → 仅选中该节点；右键已选中节点 → 保持选中集
      const { selectedNodeIds } = useCanvasStore.getState();
      if (!selectedNodeIds.includes(node.id)) {
        setSelectedNodeIds([node.id]);
      }
      openNodeMenu(event, node.id);
    },
    [openNodeMenu, setSelectedNodeIds],
  );

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      openPaneMenu(event);
    },
    [openPaneMenu],
  );

  // 构建节点右键菜单项
  const buildNodeMenuItems = (): MenuItem[] => {
    const { nodes, edges, selectedNodeIds } = useCanvasStore.getState();
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const internalEdges = edges.filter(
      (e) => selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target),
    );
    const targetNode = nodes.find((n) => n.id === menuState.targetNodeId);
    const canExecute = selectedNodeIds.length === 1 && targetNode && isExecutable(targetNode.data.subtype);

    // 对齐子菜单（仅 >=2 节点显示）
    const alignSubmenu: MenuItem[] | null = selectedNodeIds.length >= 2
      ? [
          { icon: AlignStartVertical, label: '左对齐', onClick: () => handleAlign(alignLeft) },
          { icon: AlignCenterVertical, label: '垂直居中', onClick: () => handleAlign(alignVerticalCenter) },
          { icon: AlignStartHorizontal, label: '顶对齐', onClick: () => handleAlign(alignTop) },
          { icon: AlignCenterHorizontal, label: '水平居中', onClick: () => handleAlign(alignHorizontalCenter) },
        ]
      : null;

    const items: MenuItem[] = [
      {
        icon: Copy,
        label: '复制',
        shortcut: 'Ctrl+C',
        disabled: selectedNodes.length === 0,
        onClick: () => useClipboardStore.getState().copy(selectedNodes, internalEdges),
      },
      {
        icon: ClipboardPaste,
        label: '粘贴',
        shortcut: 'Ctrl+V',
        disabled: !useClipboardStore.getState().hasClipboard(),
        onClick: () => handlePasteAtMenu(),
      },
      {
        icon: Pencil,
        label: '重命名',
        shortcut: 'F2',
        disabled: selectedNodeIds.length !== 1,
        onClick: () => setEditingNodeId(menuState.targetNodeId!),
      },
    ];

    if (canExecute) {
      items.push({
        icon: Play,
        label: '执行节点',
        shortcut: 'F5',
        onClick: () => {
          void executeNode(menuState.targetNodeId!).catch((err) => {
            toast.error(`执行失败: ${err?.message || '未知错误'}`);
          });
        },
      });
    }

    items.push({
      icon: Trash2,
      label: '删除',
      shortcut: 'Delete',
      disabled: selectedNodeIds.length === 0,
      onClick: () => removeNodes(selectedNodeIds),
    });

    if (alignSubmenu) {
      items.push({ separator: true });
      items.push({ icon: AlignStartVertical, label: '对齐', submenu: alignSubmenu });
    }

    return items;
  };

  // 构建画布空白右键菜单项
  const buildPaneMenuItems = (): MenuItem[] => {
    const items: MenuItem[] = [
      {
        icon: ClipboardPaste,
        label: '粘贴',
        shortcut: 'Ctrl+V',
        disabled: !useClipboardStore.getState().hasClipboard(),
        onClick: () => handlePasteAtMenu(),
      },
      {
        icon: AlignStartVertical,
        label: '全选',
        shortcut: 'Ctrl+A',
        onClick: () => useCanvasStore.getState().selectAll(),
      },
      { separator: true },
    ];

    // 新建节点子菜单（按类别分组，用分隔符分隔）
    const newNodesSubmenu: MenuItem[] = [];
    if (NODE_CATEGORIES) {
      const entries = Object.entries(NODE_CATEGORIES);
      entries.forEach(([typeKey, cat], catIdx) => {
        if (catIdx > 0) newNodesSubmenu.push({ separator: true });
        NODE_TEMPLATES
          .filter((t) => t.type === typeKey)
          .forEach((t) => {
            newNodesSubmenu.push({
              icon: ICON_MAP_LUCIDE[t.icon] || Type,
              label: t.label,
              onClick: () => handleAddNodeAtMenu(t.subtype),
            });
          });
      });
    }

    items.push({ icon: Type, label: '新建节点', submenu: newNodesSubmenu });

    return items;
  };

  // 在右键位置粘贴（屏幕坐标 → 画布坐标）
  const handlePasteAtMenu = () => {
    const pasted = useClipboardStore.getState().paste();
    if (!pasted) return;
    const canvasPos = reactFlowInstance.current
      ? reactFlowInstance.current.screenToFlowPosition(menuState.position)
      : menuState.position;
    useCanvasStore.getState().addPastedNodes(pasted.nodes, pasted.edges, canvasPos);
  };

  // 在右键位置新建节点
  const handleAddNodeAtMenu = (subtype: NodeSubtype) => {
    const canvasPos = reactFlowInstance.current
      ? reactFlowInstance.current.screenToFlowPosition(menuState.position)
      : menuState.position;
    addNode(subtype, canvasPos);
    markDirty();
    const newNode = useCanvasStore.getState().nodes[useCanvasStore.getState().nodes.length - 1];
    if (newNode) pushAddNode({ node: newNode });
  };

  // 对齐处理 helper
  const handleAlign = (fn: typeof alignLeft) => {
    const { nodes, selectedNodeIds, alignNodes } = useCanvasStore.getState();
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const positionable = selectedNodes.map((n) => ({
      id: n.id,
      position: n.position,
      width: n.measured?.width,
      height: n.measured?.height,
    }));
    const updates = fn(positionable);
    alignNodes(updates);
  };

  // 监听 fitViewToken 变化,触发 ReactFlow 自适应视图(AI 生成后用)
  useEffect(() => {
    if (fitViewToken === 0) return; // 跳过初始值
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
    }
  }, [fitViewToken]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={reactFlowNodes}
        edges={edges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onMouseMove={onMouseMove}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Meta', 'Control']}
        className="bg-canvas-bg"
        onContextMenu={(e) => e.preventDefault()}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2A2A3E" />
        <RemoteCursors />
        <AlignmentToolbar />
        <Controls
          position="bottom-right"
          showInteractive={false}
        />
        <MiniMap
          position="bottom-left"
          nodeColor={(node) => {
            const colors: Record<string, string> = {
              input: '#3B82F6',
              ai_inference: '#7C3AED',
              processing: '#06B6D4',
              control: '#EAB308',
              output: '#22C55E',
            };
            return colors[(node.data as unknown as CanvasNodeData).type] || '#7C3AED';
          }}
          maskColor="rgba(15, 15, 20, 0.8)"
        />
      </ReactFlow>
      <ContextMenu
        visible={menuState.visible}
        position={menuState.position}
        items={menuState.type === 'node' ? buildNodeMenuItems() : buildPaneMenuItems()}
        onClose={closeMenu}
      />
    </div>
  );
}
