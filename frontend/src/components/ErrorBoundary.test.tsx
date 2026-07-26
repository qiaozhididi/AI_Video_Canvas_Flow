import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

const Thrower = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  it('正常渲染 children', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('捕获子组件错误并显示默认 fallback', () => {
    // 抑制 console.error 噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Thrower message="测试错误" />
      </ErrorBoundary>
    );
    expect(screen.getByText(/应用发生错误/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('支持自定义 fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>自定义错误页</div>}>
        <Thrower message="测试错误" />
      </ErrorBoundary>
    );
    expect(screen.getByText('自定义错误页')).toBeInTheDocument();
    spy.mockRestore();
  });
});
