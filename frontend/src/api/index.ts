/**
 * API 统一导出
 *
 * 业务代码可从 '@/api' 统一引入所需的 API 客户端、类型与各业务模块。
 */

// 基础设施
export { ApiError, request } from './client';
export type { CanvasNode, CanvasEdge } from './client';
export type { TimelineData } from './client';

// Schema 类型（统一从 types/api re-export，方便业务代码一站式引入）
export * from '@/types/api';

// 业务模块
export { authApi } from './auth';
export { projectApi } from './project';
export { templateApi } from './template';
export { workflowApi } from './workflow';
export { mediaApi } from './media';
export type { StorageUsageResponse, StorageStatsResponse } from './media';
export { renderApi } from './render';
export { aiApi } from './ai';
export { snapshotApi } from './snapshot';
export { collabApi } from './collab';
export { invitationApi } from './invitation';
