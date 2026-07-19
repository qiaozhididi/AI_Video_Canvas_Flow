// src/common/utils/file-signature.util.ts

/**
 * M7/M9: 文件 magic number 检测与校验，防止 mimetype 伪造上传 webshell
 *
 * 设计原则（KISS）：
 * - 仅对图片做严格 magic number 校验（webshell 最常见的伪装载体，如 .php 改名 .png）
 * - 视频流（container）的 magic number 检测复杂且 webshell 风险低（浏览器不会执行 mp4），仅靠白名单 mimetype
 * - 不引入 file-type 等第三方依赖，直接读 buffer 字节判断
 */

const IMAGE_SIGNATURES: Array<{ type: string; bytes: number[] }> = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
];

/**
 * 检测 buffer 的真实图片类型（基于 magic number）
 * @returns 检测到的 mimetype；非图片或 buffer 过短返回 null
 */
export function detectImageType(buffer: Buffer): string | null {
  // 最小阈值 6 字节（GIF magic number 长度）；WebP 分支内部隐式校验 length >= 12
  if (buffer.length < 6) return null;
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      return sig.type;
    }
  }
  // WebP: RIFF????WEBP（偏移 0-3 是 RIFF，偏移 8-11 是 WEBP，需 length >= 12）
  if (buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * 校验 buffer 实际图片类型与声明 mimetype 是否匹配
 * 兼容 image/jpg 别名（实际应为 image/jpeg）
 */
export function validateImageSignature(buffer: Buffer, declaredMimetype: string): boolean {
  const detected = detectImageType(buffer);
  if (!detected) return false;
  if (detected === 'image/jpeg' && (declaredMimetype === 'image/jpeg' || declaredMimetype === 'image/jpg')) {
    return true;
  }
  return detected === declaredMimetype;
}
