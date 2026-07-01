/**
 * 节点对齐计算纯函数
 *
 * 8 种对齐方式，每个函数接收节点数组，返回需要更新的节点位置 Map。
 * 等距分布需 ≥3 节点，否则降级为左对齐/顶对齐。
 */

interface PositionableNode {
  id: string;
  position: { x: number; y: number };
}

type PositionMap = Map<string, { x: number; y: number }>;

/** 左对齐：所有节点 x = min(x) */
export function alignLeft(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  for (const n of nodes) {
    result.set(n.id, { x: minX, y: n.position.y });
  }
  return result;
}

/** 右对齐：所有节点 x = max(x) */
export function alignRight(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const maxX = Math.max(...nodes.map((n) => n.position.x));
  for (const n of nodes) {
    result.set(n.id, { x: maxX, y: n.position.y });
  }
  return result;
}

/** 顶部对齐：所有节点 y = min(y) */
export function alignTop(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const minY = Math.min(...nodes.map((n) => n.position.y));
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: minY });
  }
  return result;
}

/** 底部对齐：所有节点 y = max(y) */
export function alignBottom(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const maxY = Math.max(...nodes.map((n) => n.position.y));
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: maxY });
  }
  return result;
}

/** 水平居中：所有节点 y = avg(y) */
export function alignHorizontalCenter(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const avgY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length;
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: avgY });
  }
  return result;
}

/** 垂直居中：所有节点 x = avg(x) */
export function alignVerticalCenter(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
  for (const n of nodes) {
    result.set(n.id, { x: avgX, y: n.position.y });
  }
  return result;
}

/** 水平等距分布：按 x 排序后均匀分布 x（需 ≥3 节点，否则降级为 alignLeft） */
export function distributeHorizontal(nodes: PositionableNode[]): PositionMap {
  if (nodes.length < 3) return alignLeft(nodes);
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const firstX = sorted[0].position.x;
  const lastX = sorted[sorted.length - 1].position.x;
  const step = (lastX - firstX) / (sorted.length - 1);
  const result: PositionMap = new Map();
  sorted.forEach((n, i) => {
    result.set(n.id, { x: firstX + step * i, y: n.position.y });
  });
  return result;
}

/** 垂直等距分布：按 y 排序后均匀分布 y（需 ≥3 节点，否则降级为 alignTop） */
export function distributeVertical(nodes: PositionableNode[]): PositionMap {
  if (nodes.length < 3) return alignTop(nodes);
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  const firstY = sorted[0].position.y;
  const lastY = sorted[sorted.length - 1].position.y;
  const step = (lastY - firstY) / (sorted.length - 1);
  const result: PositionMap = new Map();
  sorted.forEach((n, i) => {
    result.set(n.id, { x: n.position.x, y: firstY + step * i });
  });
  return result;
}
