import { useCallback, useMemo } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import CanvasNodeComponent from './CanvasNode';
import type { CanvasNodeData } from '@/types/canvas';

const nodeTypes = { canvasNode: CanvasNodeComponent };

export default function Canvas() {
  const { nodes, edges, setNodes, setEdges, setSelectedNode } = useCanvasStore();

  const reactFlowNodes: Node[] = useMemo(
    () => nodes.map((n) => ({
      id: n.id,
      type: 'canvasNode',
      position: n.position,
      data: { ...n.data } as Record<string, unknown>,
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
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-canvas-bg"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2A2A3E" />
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
