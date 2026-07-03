/**
 * 节点对齐计算纯函数
 *
 * 4 种对齐方式 + 重叠错开保护。
 * 每个函数接收节点数组（含尺寸），返回需要更新的节点位置 Map。
 */

interface PositionableNode {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

type PositionMap = Map<string, { x: number; y: number }>;

// 默认节点尺寸（与 CanvasNode min-w-[180px] 对齐）
const DEFAULT_WIDTH = 180;
const DEFAULT_HEIGHT = 60;
// 节点间最小间距
const MIN_GAP = 20;

/** 安全获取节点宽度 */
function w(n: PositionableNode): number {
  return n.width || DEFAULT_WIDTH;
}

/** 安全获取节点高度 */
function h(n: PositionableNode): number {
  return n.height || DEFAULT_HEIGHT;
}

/**
 * 对齐后检测重叠并自动错开
 * 主轴对齐后，检查 crossAxis 方向是否重叠（位置差 < 节点尺寸），
 * 重叠则按顺序推开，保证最小间距
 */
function resolveOverlaps(
  positions: PositionMap,
  nodes: PositionableNode[],
  mainAxis: 'x' | 'y',
): PositionMap {
  const result = new Map(positions);
  const crossAxis = mainAxis === 'x' ? 'y' : 'x';
  const crossSize = mainAxis === 'x' ? h : w;

  // 按 crossAxis 坐标排序
  const sorted = [...nodes].sort((a, b) => {
    const pa = result.get(a.id)!;
    const pb = result.get(b.id)!;
    return pa[crossAxis] - pb[crossAxis];
  });

  // 逐个检查 crossAxis 方向是否与前一个节点重叠
  for (let i = 1; i < sorted.length; i++) {
    const prevPos = result.get(sorted[i - 1].id)!;
    const currPos = result.get(sorted[i].id)!;

    // 前一个节点在 crossAxis 方向的结束位置 + 最小间距
    const minStart = prevPos[crossAxis] + crossSize(sorted[i - 1]) + MIN_GAP;

    if (currPos[crossAxis] < minStart) {
      // 错开当前节点及后续所有节点
      const shift = minStart - currPos[crossAxis];
      for (let j = i; j < sorted.length; j++) {
        const pos = result.get(sorted[j].id)!;
        result.set(sorted[j].id, {
          ...pos,
          [crossAxis]: pos[crossAxis] + shift,
        });
      }
    }
  }

  return result;
}

/** 左对齐：所有节点 x = min(x)，自动错开 y 方向重叠 */
export function alignLeft(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  for (const n of nodes) {
    result.set(n.id, { x: minX, y: n.position.y });
  }
  return resolveOverlaps(result, nodes, 'x');
}

/** 顶部对齐：所有节点 y = min(y)，自动错开 x 方向重叠 */
export function alignTop(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const minY = Math.min(...nodes.map((n) => n.position.y));
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: minY });
  }
  return resolveOverlaps(result, nodes, 'y');
}

/** 水平居中：所有节点 y = avg(y)，自动错开 x 方向重叠 */
export function alignHorizontalCenter(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const avgY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length;
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: avgY });
  }
  return resolveOverlaps(result, nodes, 'y');
}

/** 垂直居中：所有节点 x = avg(x)，自动错开 y 方向重叠 */
export function alignVerticalCenter(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
  for (const n of nodes) {
    result.set(n.id, { x: avgX, y: n.position.y });
  }
  return resolveOverlaps(result, nodes, 'x');
}
