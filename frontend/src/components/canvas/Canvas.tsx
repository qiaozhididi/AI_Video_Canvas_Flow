import { useCallback, useMemo, useRef } from 'react';
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
  addEdge,
  BackgroundVariant,
  ConnectionLineType,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useCollabStore } from '@/stores/collabStore';
import CanvasNodeComponent from './CanvasNode';
import RemoteCursors from './RemoteCursors';
import type { CanvasNodeData, NodeSubtype } from '@/types/canvas';

const nodeTypes = { canvasNode: CanvasNodeComponent };

export default function Canvas() {
  const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode } = useCanvasStore();
  const pushAddNode = useHistoryStore((s) => s.pushAddNode);
  const markDirty = useAutoSaveStore((s) => s.markDirty);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // 将 store 中的 CanvasNode 映射为 ReactFlow Node，保留 ReactFlow 内部状态
  const reactFlowNodes: Node[] = useMemo(
    () => nodes.map((n) => ({
      id: n.id,
      type: 'canvasNode' as const,
      position: n.position,
      data: { ...n.data } as Record<string, unknown>,
      measured: n.measured,
    })),
    [nodes]
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
    },
    [reactFlowNodes, setNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, edges as Edge[]);
      setEdges(updated);
    },
    [edges, setEdges]
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const newEdges = addEdge(
        { ...connection, type: 'smoothstep', animated: true },
        edges as Edge[]
      );
      setEdges(newEdges);
    },
    [edges, setEdges]
  );

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
        nodeTypes={nodeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-canvas-bg"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2A2A3E" />
        <RemoteCursors />
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
