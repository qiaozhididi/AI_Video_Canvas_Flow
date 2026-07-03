import { describe, it, expect } from 'vitest';
import {
  alignLeft,
  alignTop,
  alignHorizontalCenter,
  alignVerticalCenter,
} from './alignment';

// 测试用节点类型（满足 PositionableNode 接口）
interface TestNode {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

const makeNode = (id: string, x: number, y: number, width?: number, height?: number): TestNode => ({
  id,
  position: { x, y },
  width,
  height,
});

const getPos = (
  result: Map<string, { x: number; y: number }>,
  id: string,
) => result.get(id);

// 默认节点高度 60 + 最小间距 20 = 80
const NODE_H = 60;
const GAP = 20;
const STRIDE = NODE_H + GAP; // 80

// 默认节点宽度 180 + 最小间距 20 = 200
const NODE_W = 180;
const X_STRIDE = NODE_W + GAP; // 200

describe('alignLeft - 左对齐', () => {
  it('空数组返回空 Map', () => {
    expect(alignLeft([]).size).toBe(0);
  });

  it('单节点：返回该节点原位置', () => {
    const result = alignLeft([makeNode('a', 10, 20)]);
    expect(getPos(result, 'a')).toEqual({ x: 10, y: 20 });
  });

  it('多节点 y 间距足够：所有 x = min(x)，y 保持不变', () => {
    const nodes = [
      makeNode('a', 30, 0),
      makeNode('b', 10, STRIDE),     // y=80，与前一个间距80，刚好不重叠
      makeNode('c', 20, STRIDE * 2), // y=160
    ];
    const result = alignLeft(nodes);
    expect(getPos(result, 'a')?.x).toBe(10);
    expect(getPos(result, 'b')?.x).toBe(10);
    expect(getPos(result, 'c')?.x).toBe(10);
    // y 不变
    expect(getPos(result, 'a')?.y).toBe(0);
    expect(getPos(result, 'b')?.y).toBe(STRIDE);
    expect(getPos(result, 'c')?.y).toBe(STRIDE * 2);
  });

  it('重叠节点自动错开 y', () => {
    const nodes = [
      makeNode('a', 30, 0),
      makeNode('b', 10, 5),   // y=5 与 a(y=0, h=60) 重叠
      makeNode('c', 20, 10),  // y=10 也重叠
    ];
    const result = alignLeft(nodes);
    expect(getPos(result, 'a')?.x).toBe(10);
    expect(getPos(result, 'b')?.x).toBe(10);
    expect(getPos(result, 'c')?.x).toBe(10);
    // y 方向自动错开
    expect(getPos(result, 'a')!.y).toBeLessThan(getPos(result, 'b')!.y);
    expect(getPos(result, 'b')!.y).toBeLessThan(getPos(result, 'c')!.y);
    // 间距 >= STRIDE
    expect(getPos(result, 'b')!.y - getPos(result, 'a')!.y).toBeGreaterThanOrEqual(STRIDE);
  });

  it('包含负坐标', () => {
    const nodes = [makeNode('a', -5, 0), makeNode('b', 5, STRIDE)];
    const result = alignLeft(nodes);
    expect(getPos(result, 'a')?.x).toBe(-5);
    expect(getPos(result, 'b')?.x).toBe(-5);
  });
});

describe('alignTop - 顶部对齐', () => {
  it('空数组返回空 Map', () => {
    expect(alignTop([]).size).toBe(0);
  });

  it('多节点 x 间距足够：所有 y = min(y)，x 不变', () => {
    const nodes = [
      makeNode('a', 0, 30),
      makeNode('b', X_STRIDE, 10),
      makeNode('c', X_STRIDE * 2, 20),
    ];
    const result = alignTop(nodes);
    expect(getPos(result, 'a')?.y).toBe(10);
    expect(getPos(result, 'b')?.y).toBe(10);
    expect(getPos(result, 'c')?.y).toBe(10);
    expect(getPos(result, 'a')?.x).toBe(0);
    expect(getPos(result, 'b')?.x).toBe(X_STRIDE);
    expect(getPos(result, 'c')?.x).toBe(X_STRIDE * 2);
  });

  it('重叠节点自动错开 x', () => {
    const nodes = [
      makeNode('a', 0, 30),
      makeNode('b', 5, 10),
      makeNode('c', 10, 20),
    ];
    const result = alignTop(nodes);
    expect(getPos(result, 'a')?.y).toBe(10);
    expect(getPos(result, 'b')?.y).toBe(10);
    expect(getPos(result, 'c')?.y).toBe(10);
    // x 方向自动错开
    expect(getPos(result, 'a')!.x).toBeLessThan(getPos(result, 'b')!.x);
    expect(getPos(result, 'b')!.x).toBeLessThan(getPos(result, 'c')!.x);
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

  it('多节点 x 间距足够：所有 y = avg(y)，x 不变', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', X_STRIDE, 30),
      makeNode('c', X_STRIDE * 2, 60),
    ];
    const result = alignHorizontalCenter(nodes);
    const avgY = 30;
    expect(getPos(result, 'a')?.y).toBe(avgY);
    expect(getPos(result, 'b')?.y).toBe(avgY);
    expect(getPos(result, 'c')?.y).toBe(avgY);
    expect(getPos(result, 'a')?.x).toBe(0);
    expect(getPos(result, 'b')?.x).toBe(X_STRIDE);
  });
});

describe('alignVerticalCenter - 垂直居中', () => {
  it('空数组返回空 Map', () => {
    expect(alignVerticalCenter([]).size).toBe(0);
  });

  it('多节点 y 间距足够：所有 x = avg(x)，y 不变', () => {
    const nodes = [
      makeNode('a', 0, 0),
      makeNode('b', 30, STRIDE),
      makeNode('c', 60, STRIDE * 2),
    ];
    const result = alignVerticalCenter(nodes);
    const avgX = 30;
    expect(getPos(result, 'a')?.x).toBe(avgX);
    expect(getPos(result, 'b')?.x).toBe(avgX);
    expect(getPos(result, 'c')?.x).toBe(avgX);
    expect(getPos(result, 'a')?.y).toBe(0);
    expect(getPos(result, 'b')?.y).toBe(STRIDE);
  });

  it('重叠节点自动错开 y', () => {
    const nodes = [
      makeNode('a', 0, 10),
      makeNode('b', 5, 20),
      makeNode('c', 10, 5),
    ];
    const result = alignVerticalCenter(nodes);
    const avgX = 5;
    expect(getPos(result, 'a')?.x).toBe(avgX);
    // y 方向自动错开
    const posA = getPos(result, 'a')!.y;
    const posB = getPos(result, 'b')!.y;
    const posC = getPos(result, 'c')!.y;
    // 所有 y 应该按顺序排列
    const ys = [posA, posB, posC].sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(STRIDE);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(STRIDE);
  });
});
