// src/common/config/configuration.ts
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
    secret: process.env.SECRET_KEY || 'change-me-to-a-secure-random-string',
    expiresIn: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 30) * 60,
    refreshExpiresIn: 60 * 24 * 7 * 60,
    algorithm: 'HS256',
  },
  cors: {
    origins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
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
