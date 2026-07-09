/**
 * 全局错误提示映射表
 *
 * 策略：直接信任后端 detail 消息 + fallback 兜底
 * - 后端返回的 detail 已是中文，优先展示
 * - 当 detail 缺失、为英文或无法识别时，按 HTTP 状态码 + 场景 fallback
 */

import { ApiError } from './apiClient';

// ═══════════════════════════════════════════════════
// 1. 场景化默认提示（按操作场景分类）
// ═══════════════════════════════════════════════════

const SCENE_MESSAGES: Record<string, string> = {
  // ── 项目 ──
  project_load: '加载项目列表失败',
  project_save: '保存项目失败',
  project_create: '创建项目失败',
  project_delete: '删除项目失败',
  project_update: '更新项目失败',
  project_refresh: '刷新项目信息失败',

  // ── 工作流 ──
  workflow_load: '加载工作流失败',
  workflow_save: '保存工作流失败',
  workflow_execute: '工作流执行失败',
  workflow_resume: '断点续执行失败',

  // ── 节点 ──
  node_execute: '节点执行失败',

  // ── 自动保存 ──
  autosave: '自动保存失败',
  autosave_snapshot: '创建快照失败',
  autosave_recovery: '检查恢复快照失败',
  snapshot_restore: '恢复快照失败',
  snapshot_delete: '删除快照失败',

  // ── 渲染任务 ──
  render_create: '创建渲染任务失败',
  render_cancel: '取消任务失败',
  render_retry: '重试任务失败',
  render_poll: '查询任务进度失败',
  render_export: '导出失败',

  // ── 媒体 ──
  media_load: '加载素材列表失败',
  media_upload: '上传文件失败',
  media_delete: '删除素材失败',
  media_download: '下载文件失败',

  // ── AI ──
  ai_generate: 'AI 生成失败',
  ai_model_load: '加载模型列表失败',
  ai_provider_save: '保存 AI 配置失败',
  ai_provider_delete: '删除 AI 配置失败',
  ai_model_save: '保存模型配置失败',
  ai_model_delete: '删除模型配置失败',
  ai_model_default: '设置默认模型失败',

  // ── 协作 ──
  collab_load: '加载协作者失败',
  collab_remove: '移除协作者失败',
  collab_update_role: '修改权限失败',
  invite_create: '创建邀请链接失败',
  invite_accept: '接受邀请失败',

  // ── 认证 ──
  auth_login: '登录失败',
  auth_register: '注册失败',
  auth_update: '更新个人信息失败',

  // ── 模板 ──
  template_clone: '克隆模板失败',
  template_publish: '发布模板失败',
  template_load: '加载模板列表失败',

  // ── 设置 ──
  settings_save: '保存设置失败',
};

// ═══════════════════════════════════════════════════
// 2. HTTP 状态码 fallback（无场景匹配时使用）
// ═══════════════════════════════════════════════════

const STATUS_MESSAGES: Record<number, string> = {
  400: '请求参数有误',
  401: '登录已过期，请重新登录',
  403: '没有操作权限',
  404: '请求的资源不存在',
  408: '请求超时，请稍后重试',
  409: '操作冲突，请刷新后重试',
  410: '资源已失效',
  422: '提交的数据有误',
  500: '服务器内部错误，请稍后重试',
  502: '服务暂时不可用，请稍后重试',
  503: '服务维护中，请稍后重试',
};

// ═══════════════════════════════════════════════════
// 3. 核心：获取用户友好的错误消息
// ═══════════════════════════════════════════════════

/**
 * 从错误对象中提取用户友好的提示消息
 *
 * 优先级：
 * 1. ApiError.detail（后端返回的中文消息）
 * 2. 场景 fallback
 * 3. HTTP 状态码 fallback
 * 4. 通用兜底
 */
export function getErrorMessage(
  err: unknown,
  scene?: string,
): string {
  // 1. ApiError：优先使用后端 detail
  if (err instanceof ApiError) {
    const detail = err.message;
    // 后端 detail 为中文且非纯状态码描述 → 直接使用
    if (detail && /[\u4e00-\u9fff]/.test(detail)) {
      return detail;
    }
    // 否则按状态码 + 场景 fallback
    return scene
      ? SCENE_MESSAGES[scene] ?? STATUS_MESSAGES[err.status] ?? SCENE_MESSAGES[scene] ?? '操作失败，请稍后重试'
      : STATUS_MESSAGES[err.status] ?? '操作失败，请稍后重试';
  }

  // 2. Error 实例
  if (err instanceof Error) {
    const msg = err.message;
    // 如果消息包含中文，可能是后端透传的
    if (msg && /[\u4e00-\u9fff]/.test(msg)) {
      return msg;
    }
    // 英文/技术性消息 → 不展示给用户
    return scene
      ? SCENE_MESSAGES[scene] ?? '操作失败，请稍后重试'
      : '操作失败，请稍后重试';
  }

  // 3. 兜底
  return scene
    ? SCENE_MESSAGES[scene] ?? '操作失败，请稍后重试'
    : '操作失败，请稍后重试';
}

/**
 * 快捷获取场景提示（不依赖错误对象，用于简单场景）
 */
export function getSceneMessage(scene: string): string {
  return SCENE_MESSAGES[scene] ?? '操作失败，请稍后重试';
}
