// src/common/config/configuration.ts
// M-2: JWT 默认密钥常量集中管理（main.ts 启动校验与 configuration 共用，避免硬编码重复）
export const JWT_DEFAULT_SECRET = 'change-me-to-a-secure-random-string';

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) {
    // 默认：5173-5183 端口范围（对齐 Python config.py）
    return Array.from({ length: 11 }, (_, i) => `http://localhost:${5173 + i}`);
  }
  // 尝试 JSON 数组格式（Python 兼容）：["http://localhost:5173"]
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // 非 JSON，按逗号分隔处理
  }
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export default () => ({
  project: { name: 'ai-canvas-flow-backend', debug: false },
  database: {
    url: process.env.DATABASE_URL?.replace('postgresql+asyncpg://', 'postgresql://')
      || 'postgresql://postgres:postgres@localhost:5432/ai_canvas_flow',
  },
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379/0' },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'ai-canvas-flow',
    secure: process.env.MINIO_SECURE === 'true',
  },
  jwt: {
    secret: process.env.SECRET_KEY || JWT_DEFAULT_SECRET,
    expiresIn: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 30) * 60,
    refreshExpiresIn: 60 * 24 * 7 * 60,
    algorithm: 'HS256',
  },
  cors: {
    origins: parseCorsOrigins(),
  },
  defaultAi: {
    providerName: process.env.DEFAULT_AI_PROVIDER_NAME || '火山引擎',
    platform: process.env.DEFAULT_AI_PLATFORM || 'volcengine',
    baseUrl: process.env.DEFAULT_AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: process.env.DEFAULT_AI_API_KEY || '',
    modelId: process.env.DEFAULT_AI_MODEL_ID || 'doubao-seed-2-1-turbo-260628',
    modelDisplayName: process.env.DEFAULT_AI_MODEL_DISPLAY_NAME || '豆包 Seed 2.1 Turbo',
    modelType: process.env.DEFAULT_AI_MODEL_TYPE || 'llm',
  },
});
