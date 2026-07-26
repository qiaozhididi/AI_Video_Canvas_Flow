/**
 * 兼容 shim：原 apiClient.ts 已拆分为 @/api/* 和 @/types/api
 * 此文件仅做 re-export，避免破坏现有 import { ... } from '@/utils/apiClient'
 *
 * 新代码请直接 import from '@/api'
 */
export * from '@/api';
