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
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useCollabStore } from '@/stores/collabStore';
import CanvasNodeComponent from './CanvasNode';
import RemoteCursors from './RemoteCursors';
import AlignmentToolbar from './AlignmentToolbar';
import type { CanvasNodeData, NodeSubtype } from '@/types/canvas';

const nodeTypes = { canvasNode: CanvasNodeComponent };

export default function Canvas() {
  const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode, fitViewToken, selectedNodeIds, setSelectedNodeIds } = useCanvasStore();
  const pushAddNode = useHistoryStore((s) => s.pushAddNode);
  const markDirty = useAutoSaveStore((s) => s.markDirty);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

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
      const updated = applyNodeChanges(changes, reactFlowNodes);
      setNodes(
        updated.map((n) => ({
          id: n.id,
          type: (n.data as unknown as CanvasNodeData).type,
          position: n.position,
          data: n.data as unknown as CanvasNodeData,
          measured: n.measured,
        }))
      );

      // 协作广播：拖动结束广播节点 update；删除广播节点 delete。
      // 拖动中（dragging=true）不广播，避免高频。applyRemote 走 store set() 直接改 state，
      // 不经过此回调（仅 React Flow 内部交互触发），故无回环。
      const projectId = useCollabStore.getState().currentProjectId;
      if (!projectId) return;
      for (const change of changes) {
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
        } else if (change.type === 'remove') {
          useCollabStore.getState().emitNodeUpdate({
            project_id: projectId,
            node_id: change.id,
            action: 'delete',
          });
        }
      }
    },
    [reactFlowNodes, setNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, edges as Edge[]);
      setEdges(updated);

      // 协作广播：删除广播 edge delete
      const projectId = useCollabStore.getState().currentProjectId;
      if (!projectId) return;
      for (const change of changes) {
        if (change.type === 'remove') {
          useCollabStore.getState().emitEdgeUpdate({
            project_id: projectId,
            edge_id: change.id,
            action: 'delete',
          });
        }
      }
    },
    [edges, setEdges]
  );

  const onConnect: OnConnect = useCallback((connection) => {
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
  }, [setSelectedNode]);

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
    </div>
  );
}
