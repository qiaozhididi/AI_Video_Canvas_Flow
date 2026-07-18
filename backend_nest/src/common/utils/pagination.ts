// src/common/utils/pagination.ts
// I9: 统一 list 接口的 limit 上限保护，防止恶意拉取全表

/**
 * 限制 limit 在 [1, max] 范围内，非法值返回默认值。
 * @param limit 原始 limit 值（可能来自 query string，类型未知）
 * @param defaultValue 默认值（当 limit 非法时使用）
 * @param maxValue 最大允许值
 */
export function clampLimit(limit: unknown, defaultValue = 50, maxValue = 100): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

/**
 * 限制 offset 在 [0, max] 范围内，非法值/负值返回 0。
 * @param offset 原始 offset 值（可能来自 query string）
 * @param maxValue 最大允许值（防止深分页性能退化，默认 10000）
 */
export function clampOffset(offset: unknown, maxValue = 10000): number {
  const n = Number(offset);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), maxValue);
}
