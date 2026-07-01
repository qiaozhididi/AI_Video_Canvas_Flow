import { describe, it, expect } from 'vitest';
import {
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignHorizontalCenter,
  alignVerticalCenter,
  distributeHorizontal,
  distributeVertical,
} from './alignment';

// 测试用节点类型（满足 PositionableNode 接口）
interface Node {
  id: string;
  position: { x: number; y: number };
}

const makeNode = (id: string, x: number, y: number): Node => ({
  id,
  position: { x, y },
});

const getPos = (
  result: Map<string, { x: number; y: number }>,
  id: string,
) => result.get(id);

describe('alignLeft - 左对齐', () => {
  it('空数组返回空 Map', () => {
    expect(alignLeft([]).size).toBe(0);
  });

  it('单节点：返回该节点原位置', () => {
    const result = alignLeft([makeNode('a', 10, 20)]);
    expect(getPos(result, 'a')).toEqual({ x: 10, y: 20 });
  });

  it('多节点：所有 x = min(x)，y 保持不变', () => {
    const nodes = [
      makeNode('a', 30, 10),
      makeNode('b', 10, 20),
      makeNode('c', 20, 30),
    ];
    const result = alignLeft(nodes);
    expect(getPos(result, 'a')?.x).toBe(10);
    expect(getPos(result, 'b')?.x).toBe(10);
    expect(getPos(result, 'c')?.x).toBe(10);
    // y 不变
    expect(getPos(result, 'a')?.y).toBe(10);
    expect(getPos(result, 'b')?.y).toBe(20);
    expect(getPos(result, 'c')?.y).toBe(30);
  });

  it('包含负坐标', () => {
    const nodes = [makeNode('a', -5, 0), makeNode('b', 5, 0)];
    const result = alignLeft(nodes);
    expect(getPos(result, 'a')?.x).toBe(-5);
    expect(getPos(result, 'b')?.x).toBe(-5);
  });
});

describe('alignRight - 右对齐', () => {
  it('空数组返回空 Map', () => {
    expect(alignRight([]).size).toBe(0);
  });

  it('多节点：所有 x = max(x)，y 不变', () => {
    const nodes = [
      makeNode('a', 30, 10),
      makeNode('b', 10, 20),
      makeNode('c', 20, 30),
    ];
    const result = alignRight(nodes);
    expect(getPos(result, 'a')?.x).toBe(30);
    expect(getPos(result, 'b')?.x).toBe(30);
    expect(getPos(result, 'c')?.x).toBe(30);
    expect(getPos(result, 'a')?.y).toBe(10);
  });
});

describe('alignTop - 顶部对齐', () => {
  it('空数组返回空 Map', () => {
    expect(alignTop([]).size).toBe(0);
  });

  it('多节点：所有 y = min(y)，x 不变', () => {
    const nodes = [
      makeNode('a', 10, 30),
      makeNode('b', 20, 10),
      makeNode('c', 30, 20),
    ];
    const result = alignTop(nodes);
    expect(getPos(result, 'a')?.y).toBe(10);
    expect(getPos(result, 'b')?.y).toBe(10);
    expect(getPos(result, 'c')?.y).toBe(10);
    expect(getPos(result, 'a')?.x).toBe(10);
    expect(getPos(result, 'b')?.x).toBe(20);
    expect(getPos(result, 'c')?.x).toBe(30);
  });
});

describe('alignBottom - 底部对齐', () => {
  it('空数组返回空 Map', () => {
    expect(alignBottom([]).size).toBe(0);
  });

  it('多节点：所有 y = max(y)，x 不变', () => {
    const nodes = [
      makeNode('a', 10, 30),
      makeNode('b', 20, 10),
      makeNode('c', 30, 20),
    ];
    const result = alignBottom(nodes);
    expect(getPos(result, 'a')?.y).toBe(30);
    expect(getPos(result, 'b')?.y).toBe(30);
    expect(getPos(result, 'c')?.y).toBe(30);
    expect(getPos(result, 'a')?.x).toBe(10);
  });
});

describe('alignHorizontalCenter - 水平居中', () => {
  it('空数组返回空 Map', () => {
    expect(alignHorizontalCenter([]).size).toBe(0);
  });

  it('单节点：y 不变', () => {
    const result = alignHorizontalCenter([makeNode('a', 10, 50)]);
    expect(getPos(result, 'a')).toEqual({ x: 10, y: 50 });
  });

  it('多节点：所有 y = avg(y)，x 不变', () => {
    const nodes = [
      makeNode('a', 10, 0),
      makeNode('b', 20, 30),
      makeNode('c', 30, 60),
    ];
    const result = alignHorizontalCenter(nodes);
    const avgY = (0 + 30 + 60) / 3; // 30
    expect(getPos(result, 'a')?.y).toBe(avgY);
    expect(getPos(result, 'b')?.y).toBe(avgY);
    expect(getPos(result, 'c')?.y).toBe(avgY);
    expect(getPos(result, 'a')?.x).toBe(10);
  });
});

describe('alignVerticalCenter - 垂直居中', () => {
  it('空数组返回空 Map', () => {
    expect(alignVerticalCenter([]).size).toBe(0);
  });

  it('多节点：所有 x = avg(x)，y 不变', () => {
    const nodes = [
      makeNode('a', 0, 10),
      makeNode('b', 30, 20),
      makeNode('c', 60, 30),
    ];
    const result = alignVerticalCenter(nodes);
    const avgX = (0 + 30 + 60) / 3; // 30
    expect(getPos(result, 'a')?.x).toBe(avgX);
    expect(getPos(result, 'b')?.x).toBe(avgX);
    expect(getPos(result, 'c')?.x).toBe(avgX);
    expect(getPos(result, 'a')?.y).toBe(10);
  });
});

describe('distributeHorizontal - 水平等距分布', () => {
  it('空数组返回空 Map', () => {
    expect(distributeHorizontal([]).size).toBe(0);
  });

  it('单节点：降级为 alignLeft，返回原位置', () => {
    const result = distributeHorizontal([makeNode('a', 42, 10)]);
    expect(getPos(result, 'a')).toEqual({ x: 42, y: 10 });
  });

  it('2 节点：降级为 alignLeft（所有 x = min(x)）', () => {
    const nodes = [makeNode('a', 100, 0), makeNode('b', 20, 0)];
    const result = distributeHorizontal(nodes);
    // 降级后两个节点 x 都等于 min(100, 20) = 20
    expect(getPos(result, 'a')?.x).toBe(20);
    expect(getPos(result, 'b')?.x).toBe(20);
  });

  it('3 节点：按 x 排序后均匀分布', () => {
    // 顺序打乱，验证排序逻辑
    const nodes = [
      makeNode('a', 100, 1),
      makeNode('b', 0, 2),
      makeNode('c', 50, 3),
    ];
    const result = distributeHorizontal(nodes);
    // 排序后: b(0), c(50), a(100) → firstX=0, lastX=100, step=50
    expect(getPos(result, 'b')?.x).toBe(0);
    expect(getPos(result, 'c')?.x).toBe(50);
    expect(getPos(result, 'a')?.x).toBe(100);
    // y 保持不变
    expect(getPos(result, 'a')?.y).toBe(1);
    expect(getPos(result, 'b')?.y).toBe(2);
    expect(getPos(result, 'c')?.y).toBe(3);
  });

  it('4 节点：步长 = (last - first) / 3', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 30, 0),
      makeNode('c', 60, 0),
      makeNode('d', 90, 0),
    ];
    const result = distributeHorizontal(nodes);
    expect(getPos(result, 'a')?.x).toBe(0);
    expect(getPos(result, 'b')?.x).toBe(30);
    expect(getPos(result, 'c')?.x).toBe(60);
    expect(getPos(result, 'd')?.x).toBe(90);
  });

  it('不修改原数组（验证浅拷贝排序）', () => {
    const nodes = [
      makeNode('a', 100, 0),
      makeNode('b', 0, 0),
      makeNode('c', 50, 0),
    ];
    distributeHorizontal(nodes);
    // 原数组顺序不变
    expect(nodes[0].id).toBe('a');
    expect(nodes[1].id).toBe('b');
    expect(nodes[2].id).toBe('c');
  });
});

describe('distributeVertical - 垂直等距分布', () => {
  it('空数组返回空 Map', () => {
    expect(distributeVertical([]).size).toBe(0);
  });

  it('2 节点：降级为 alignTop（所有 y = min(y)）', () => {
    const nodes = [makeNode('a', 0, 100), makeNode('b', 0, 20)];
    const result = distributeVertical(nodes);
    expect(getPos(result, 'a')?.y).toBe(20);
    expect(getPos(result, 'b')?.y).toBe(20);
  });

  it('3 节点：按 y 排序后均匀分布，x 不变', () => {
    const nodes = [
      makeNode('a', 1, 100),
      makeNode('b', 2, 0),
      makeNode('c', 3, 50),
    ];
    const result = distributeVertical(nodes);
    // 排序后: b(0), c(50), a(100) → step=50
    expect(getPos(result, 'b')?.y).toBe(0);
    expect(getPos(result, 'c')?.y).toBe(50);
    expect(getPos(result, 'a')?.y).toBe(100);
    // x 保持不变
    expect(getPos(result, 'a')?.x).toBe(1);
    expect(getPos(result, 'b')?.x).toBe(2);
    expect(getPos(result, 'c')?.x).toBe(3);
  });
});
