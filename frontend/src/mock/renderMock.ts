import type { RenderTaskResponse } from '@/utils/apiClient';

export const isMockRender = import.meta.env.VITE_MOCK_MEDIA === 'true';

export function generateMockRenderTasks(): RenderTaskResponse[] {
  const statuses = ['queued', 'running', 'completed', 'failed'] as const;
  const projects = ['AI 短片 - 城市夜景', '角色动画测试', 'BGM 混音导出', '文生图批量输出', '语音合成测试'];
  const types = ['render', 'text2img', 'ai_generate', 'render', 'tts'];

  return Array.from({ length: 5 }, (_, i) => ({
    id: `mock-render-${i.toString().padStart(3, '0')}`,
    project_id: `mock-proj-${i}`,
    owner_id: '00000000-0000-0000-0000-000000000001',
    task_type: types[i],
    status: statuses[i],
    progress: statuses[i] === 'completed' ? 1.0 : statuses[i] === 'running' ? 0.67 : statuses[i] === 'failed' ? 0.45 : 0.0,
    celery_task_id: `celery-mock-${i}`,
    result_url: statuses[i] === 'completed' ? `mock/render/${i}/output.mp4` : null,
    error_message: statuses[i] === 'failed' ? 'AI 推理服务超时' : null,
    created_at: new Date(Date.now() - i * 3600_000).toISOString(),
    updated_at: new Date(Date.now() - i * 1800_000).toISOString(),
  }));
}
