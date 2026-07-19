# NestJS 后端重构设计文档

> **日期**: 2026-07-13
> **分支**: `refactor/nestjs-backend`
> **目标**: 将现有 FastAPI 后端完整重构为 NestJS (TypeScript)，保持 API 完全兼容

## 1. 背景与目标

### 1.1 现有后端架构

| 组件 | 技术 |
|------|------|
| Web 框架 | FastAPI 0.115 (Python 3.12+) |
| ORM | SQLAlchemy 2.0 (async) + asyncpg |
| 任务队列 | Celery + RabbitMQ |
| 缓存 | Redis |
| 对象存储 | MinIO |
| 实时通信 | python-socketio |
| 认证 | JWT (python-jose + bcrypt) |
| 数据库迁移 | Alembic |

**现有模块**: 11 个 API 路由 + 11 个 ORM 模型 + 4 个服务 + Celery 任务 + WebSocket 协作

### 1.2 重构目标

1. **技术栈统一**: 全 TypeScript (前端 React + 后端 NestJS)
2. **API 完全兼容**: 路径、请求/响应格式、状态码与 FastAPI 完全一致
3. **复用现有 Schema**: TypeORM 实体直接映射现有 PostgreSQL 表，不修改表结构
4. **架构现代化**: 利用 NestJS DI 容器、模块化设计、装饰器模式

### 1.3 技术选型决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| ORM | TypeORM | NestJS 官方深度集成，与 SQLAlchemy 模型映射直观 |
| 任务队列 | BullMQ | Node.js 原生，基于 Redis，与 NestJS 集成良好 |
| WebSocket | @nestjs/platform-socket.io | 与前端 Socket.IO Client 完全兼容 |
| 数据库迁移 | 复用现有 schema | 新旧后端可共用数据库，平滑过渡 |
| API 兼容性 | 完全兼容 | 前端无需任何修改即可切换 |

## 2. 架构概览

### 2.1 项目结构

```
backend_nest/
├── src/
│   ├── main.ts                       # 应用入口 (NestFactory + Socket.IO 适配器)
│   ├── app.module.ts                 # 根模块 (汇总所有模块)
│   ├── common/                       # 通用模块
│   │   ├── config/                   # 配置模块 (@nestjs/config)
│   │   ├── database/                 # 数据库模块 (TypeORM)
│   │   ├── auth/                     # JWT 认证模块
│   │   ├── decorators/               # 自定义装饰器 (@CurrentUser, @Public)
│   │   ├── filters/                  # 异常过滤器 (FastAPI 兼容错误格式)
│   │   ├── guards/                   # 认证守卫 (JWT + 可选 Token)
│   │   ├── interceptors/             # 拦截器 (请求日志)
│   │   └── utils/                    # 工具 (MinIO 客户端)
│   ├── modules/                      # 业务模块
│   │   ├── auth/                     # 认证 (注册/登录/用户信息)
│   │   ├── projects/                 # 项目 CRUD + 封面上传
│   │   ├── workflows/                # 工作流节点/边
│   │   ├── media/                    # 媒体资产 (MinIO)
│   │   ├── render/                   # 渲染任务
│   │   ├── ai/                       # AI Provider/Model + 工作流生成
│   │   ├── snapshots/                # 项目快照
│   │   ├── templates/                # 模板市场
│   │   ├── invitations/              # 项目邀请
│   │   └── collaboration/            # 协作状态 API
│   ├── queue/                        # BullMQ 任务队列
│   │   ├── queue.module.ts           # 队列模块
│   │   ├── render.processor.ts       # 渲染/AI 任务处理器
│   │   └── queue.service.ts          # 队列入队服务
│   └── ws/                           # WebSocket 协作
│       ├── ws.module.ts              # WebSocket 模块
│       ├── collaboration.gateway.ts  # Socket.IO 网关
│       └── node-lock.service.ts      # 节点锁服务 (租约模型)
├── test/                             # 测试
│   ├── unit/                         # 单元测试
│   └── e2e/                          # 集成测试
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .env.example
└── Dockerfile
```

### 2.2 核心设计原则

1. **模块化**: 每个业务模块自包含 (entity + service + controller + dto)，通过 AppModule 汇总
2. **依赖注入**: 充分利用 NestJS DI 容器，服务可替换可测试
3. **API 兼容**: 所有路由路径、请求/响应格式与 FastAPI 完全一致 (`/api/v1/*`)
4. **复用 Schema**: TypeORM 实体直接映射现有 PostgreSQL 表，不修改表结构
5. **技术栈统一**: 全 TypeScript (NestJS + TypeORM + BullMQ + Socket.IO)

### 2.3 技术栈映射

| 现有 (FastAPI) | 新 (NestJS) |
|----------------|-------------|
| FastAPI 0.115 | NestJS 10.x |
| SQLAlchemy 2.0 async | TypeORM 0.3.x |
| Pydantic Settings | @nestjs/config |
| python-jose (JWT) | @nestjs/jwt + passport |
| passlib (bcrypt) | bcryptjs |
| Celery + RabbitMQ | BullMQ + Redis |
| python-socketio | @nestjs/platform-socket.io |
| httpx (AI API) | axios |
| minio (Python SDK) | minio (Node.js SDK) |
| Alembic | TypeORM synchronize=false (复用现有 schema) |

## 3. 核心基础设施设计

### 3.1 配置模块 (ConfigModule)

使用 `@nestjs/config` 管理环境变量，与现有 `.env` 完全兼容:

```typescript
// src/common/config/configuration.ts
export default () => ({
  project: { name: 'ai-canvas-flow-backend', version: '0.1.0', debug: false },
  database: {
    // TypeORM 使用 pg 驱动，URL 格式: postgresql://user:pass@host:port/db
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
```

**关键点**:
- 数据库 URL 从 `postgresql+asyncpg://` 转换为 `postgresql://` (TypeORM 使用 pg 驱动)
- 所有环境变量与现有 `.env.example` 保持一致

### 3.2 数据库模块 (DatabaseModule)

使用 TypeORM 连接 PostgreSQL，复用现有 schema:

```typescript
// src/common/database/database.module.ts
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('database.url'),
        entities: [__dirname + '/../../modules/**/*.entity{.ts,.js}'],
        synchronize: false,  // 复用现有 schema，不自动同步
        logging: config.get('project.debug') ? 'all' : ['error'],
        poolSize: 5,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

**实体映射规则**:
- Python `UUID` → TypeScript `string` (TypeORM uuid 类型)
- Python `JSONB` → TypeScript `object` (TypeORM jsonb 类型)
- Python `TIMESTAMP WITHOUT TIME ZONE` → TypeScript `Date` (TypeORM timestamp 类型)
- 表名/列名与现有完全一致 (snake_case，通过 `@Column({ name: 'snake_case' })` 映射)

### 3.3 认证模块 (AuthModule - 核心基础设施)

```typescript
// JWT 策略
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.secret'),
    });
  }
  async validate(payload: any): Promise<string> {
    return payload.sub;  // 返回 user_id 字符串，与 FastAPI get_current_user 一致
  }
}

// 可选 Token 守卫 (支持 query param，用于 <video>/<img> 标签)
@Injectable()
export class OptionalTokenGuard implements CanActivate {
  // 优先 Authorization header，fallback 到 ?token=xxx
}

// 装饰器
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;  // user_id 字符串
  },
);
```

**关键兼容性**:
- JWT payload 使用 `sub` 字段存储 user_id (与现有 FastAPI 一致)
- `CurrentUser` 装饰器返回 `user_id: string` (与现有 `get_current_user` 一致)
- 支持 `?token=xxx` 查询参数 (用于 `CurrentUserWithToken` 场景)

### 3.4 通用工具

**MinIO 服务**:
```typescript
@Injectable()
export class MinioService {
  private client: Minio.Client;

  async uploadFile(bucket: string, objectName: string, data: Buffer, contentType: string): Promise<void>;
  async getPresignedUrl(bucket: string, objectName: string, expiresHours: number): Promise<string>;
  async statObject(bucket: string, objectName: string): Promise<boolean>;
  async downloadObject(bucket: string, objectName: string): Promise<Buffer>;
}
```

**异常过滤器** (FastAPI 兼容错误格式):
```typescript
@Catch()
export class FastApiCompatFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // HttpException 的 response 可能是字符串或对象
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : (res as any).message || exception.message;
      // 转换为 FastAPI 格式: { detail: string }
      response.status(status).json({ detail: message });
    } else {
      response.status(500).json({ detail: '服务器内部错误' });
    }
  }
}
```

**错误消息约束**:
- 后端错误消息使用纯中文 (如 "项目不存在", "Provider 不存在")
- AI 服务错误不暴露内部异常 (使用 "AI 服务暂时不可用，请稍后重试")

## 4. 业务模块设计

### 4.1 模块依赖关系

```
Auth (无依赖)
  ↓
Projects (依赖 Auth)
  ↓
├── Workflows (依赖 Projects)
├── Media (依赖 Projects + MinioService)
├── Render (依赖 Projects + QueueService)
├── Snapshots (依赖 Projects)
├── Templates (依赖 Projects)
├── Invitations (依赖 Projects)
└── Collaboration (依赖 Projects)
AI (依赖 Auth, 被 Render 引用)
```

### 4.2 认证模块 (AuthModule)

**实体**: User (映射 `users` 表)

```typescript
@Entity('users')
export class User {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 64, unique: true }) username: string;
  @Column({ length: 255, unique: true }) email: string;
  @Column({ name: 'hashed_password', length: 255 }) hashedPassword: string;
  @Column({ name: 'avatar_url', length: 512, nullable: true }) avatarUrl: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

**服务**:
- `register(username, email, password)`: bcryptjs 哈希 (算法兼容 Python bcrypt) + 创建用户
- `login(username, password)`: 验证密码 + 生成 JWT (access_token + refresh_token, 7天)
- `getMe(userId)`: 返回用户信息
- `updateMe(userId, data)`: 更新用户名/邮箱/头像 (含唯一性校验)

**端点**:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `PUT /api/v1/auth/me`

### 4.3 项目模块 (ProjectsModule)

**实体**: Project (映射 `projects` 表，含模板字段)

```typescript
@Entity('projects')
export class Project {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 128 }) name: string;
  @Column('text', { nullable: true }) description: string;
  @Column({ name: 'cover_url', length: 512, nullable: true }) coverUrl: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'is_template', default: false }) isTemplate: boolean;
  @Column({ name: 'template_category', length: 64, nullable: true }) templateCategory: string;
  @Column({ name: 'template_tags', type: 'jsonb', nullable: true }) templateTags: any;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

**服务**:
- `list(userId)`: 返回项目列表 (含 node_count 批量查询)
- `create(userId, data)`: 创建项目
- `get(userId, projectId)`: 获取详情 (含 node_count)
- `update(userId, projectId, data)`: 部分更新
- `delete(userId, projectId)`: 级联删除 (事务: edges → nodes → snapshots → render_tasks → media_assets → project)
- `uploadCover(userId, projectId, file)`: 上传封面到 MinIO `covers/{pid}.png`
- `downloadCover(userId, projectId)`: 代理下载封面

**端点**:
- `GET /api/v1/projects/`
- `POST /api/v1/projects/`
- `GET /api/v1/projects/{id}`
- `PUT /api/v1/projects/{id}`
- `DELETE /api/v1/projects/{id}`
- `POST /api/v1/projects/{id}/cover`
- `GET /api/v1/projects/{id}/cover/download`

### 4.4 工作流模块 (WorkflowsModule)

**实体**: WorkflowNode, WorkflowEdge

```typescript
@Entity('workflow_nodes')
export class WorkflowNode {
  @PrimaryColumn({ length: 128 }) id: string;  // 字符串主键 (兼容 ReactFlow)
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'node_type', length: 64 }) nodeType: string;
  @Column({ length: 128 }) label: string;
  @Column({ name: 'position_x', type: 'float' }) positionX: number;
  @Column({ name: 'position_y', type: 'float' }) positionY: number;
  @Column({ type: 'json' }) config: any;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

@Entity('workflow_edges')
export class WorkflowEdge {
  @PrimaryColumn({ length: 128 }) id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'source_node_id', length: 128 }) sourceNodeId: string;
  @Column({ name: 'target_node_id', length: 128 }) targetNodeId: string;
  @Column({ name: 'source_port', length: 64, nullable: true }) sourcePort: string;
  @Column({ name: 'target_port', length: 64, nullable: true }) targetPort: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

**服务**:
- `listNodes(projectId)` / `createNode(projectId, data)` / `deleteNode(projectId, nodeId)`
- `listEdges(projectId)` / `createEdge(projectId, data)` / `deleteEdge(projectId, edgeId)`
- `saveWorkflow(projectId, nodes, edges)`: 批量保存 (事务: 先删后插，先 flush 节点再插边)

**端点**:
- `GET/POST /api/v1/workflows/{id}/nodes`
- `DELETE /api/v1/workflows/{id}/nodes/{nodeId}`
- `GET/POST /api/v1/workflows/{id}/edges`
- `DELETE /api/v1/workflows/{id}/edges/{edgeId}`
- `PUT /api/v1/workflows/{id}/save`

### 4.5 媒体模块 (MediaModule)

**实体**: MediaAsset (映射 `media_assets` 表)

**服务**:
- `list(userId, pagination)`: 分页列表
- `upload(userId, projectId, file)`: 上传到 MinIO + 创建记录
- `get(userId, mediaId)`: 详情
- `getPresign(userId, mediaId)`: 预签名 URL (1小时)
- `download(userId, mediaId)`: 代理下载
- `delete(userId, mediaId)`: 删除 MinIO + DB 记录

**端点**:
- `GET /api/v1/media/`
- `POST /api/v1/media/upload`
- `GET /api/v1/media/{id}`
- `GET /api/v1/media/{id}/presign`
- `GET /api/v1/media/{id}/download`
- `DELETE /api/v1/media/{id}`

### 4.6 渲染模块 (RenderModule)

**实体**: RenderTask (映射 `render_tasks` 表，含 node_id/model_id/prompt/input_artifacts)

```typescript
@Entity('render_tasks')
export class RenderTask {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'node_id', length: 128, nullable: true }) nodeId: string;
  @Column({ name: 'task_type', length: 64 }) taskType: string;
  @Column({ length: 32 }) status: string;
  @Column({ type: 'int', default: 0 }) progress: number;  // 0-100 整数
  @Column({ name: 'celery_task_id', length: 256, nullable: true }) celeryTaskId: string;  // 复用现有列名，存储 BullMQ job ID
  @Column({ name: 'model_id', type: 'uuid', nullable: true }) modelId: string;
  @Column('text', { nullable: true }) prompt: string;
  @Column({ name: 'input_artifacts', type: 'json', nullable: true }) inputArtifacts: any;
  @Column({ name: 'result_url', length: 512, nullable: true }) resultUrl: string;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

**服务**:
- `list(userId, status?)`: 任务列表
- `create(userId, data)`: 创建任务 + 入队 BullMQ
- `get(userId, taskId)`: 查询状态 (返回 node_label/project_name)
- `cancel(userId, taskId)`: 取消任务 (BullMQ job.remove)

**端点**:
- `GET /api/v1/render/`
- `POST /api/v1/render/`
- `GET /api/v1/render/{id}`
- `POST /api/v1/render/{id}/cancel`

### 4.7 AI 模块 (AiModule)

**实体**: AiProvider, AiModel

```typescript
@Entity('ai_providers')
export class AiProvider {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ length: 128 }) name: string;
  @Column({ length: 64 }) platform: string;
  @Column({ name: 'base_url', length: 512 }) baseUrl: string;
  @Column({ name: 'api_key', length: 512 }) apiKey: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

@Entity('ai_models')
export class AiModel {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'provider_id', type: 'uuid' }) providerId: string;
  @Column({ name: 'model_id', length: 128 }) modelId: string;
  @Column({ name: 'display_name', length: 128 }) displayName: string;
  @Column({ name: 'model_type', length: 32 }) modelType: string;  // llm/image_gen/video_gen/tts
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ name: 'is_default', default: false }) isDefault: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

**服务**:
- Provider CRUD: `createProvider/listProviders/updateProvider/deleteProvider`
- Model CRUD: `createModel/listModels/updateModel/deleteModel`
- `getDefaultModel(userId, modelType?)`: 获取默认模型
- `ensureDefaultAiConfig(userId)`: 首次启动自动创建默认配置
- `generateWorkflow(userId, description, mode, modelId?)`: AI 生成工作流
- `generateSubtitles(userId, prompt, duration, modelId?)`: AI 生成字幕
- `callLlm(modelId, messages, userId)`: 调用 LLM (OpenAI Chat Completions 兼容)
- `callImageGen(modelId, params, userId)`: 文生图 (OpenAI Images API)
- `callVideoGen(modelId, params, userId)`: 图生视频 (Ark 异步 API)
- `callAudioGen(modelId, params, userId)`: TTS (Ark 异步 API)

**端点**:
- `GET/POST /api/v1/ai/providers`
- `PUT/DELETE /api/v1/ai/providers/{id}`
- `GET/POST /api/v1/ai/models`
- `PUT/DELETE /api/v1/ai/models/{id}`
- `GET /api/v1/ai/models/default`
- `POST /api/v1/ai/generate-workflow`
- `POST /api/v1/ai/generate-subtitles`

### 4.8 快照模块 (SnapshotsModule)

**实体**: ProjectSnapshot (映射 `project_snapshots` 表，JSONB snapshot_data)

**服务**:
- `create(userId, projectId, source, label?)`: 创建快照 (auto 源受 5 条上限)
- `list(userId, projectId, source?)`: 快照列表
- `getLatest(userId, projectId)`: 最新快照
- `get(userId, snapshotId)` / `delete(userId, snapshotId)`
- `restore(userId, snapshotId)`: 单事务恢复 (删除现有 nodes/edges + 插入快照数据)

**端点**:
- `POST /api/v1/projects/{id}/snapshots`
- `GET /api/v1/projects/{id}/snapshots`
- `GET /api/v1/projects/{id}/snapshots/latest`
- `GET /api/v1/snapshots/{id}`
- `DELETE /api/v1/snapshots/{id}`
- `POST /api/v1/snapshots/{id}/restore`

### 4.9 模板模块 (TemplatesModule)

**服务** (复用 Project 实体):
- `list(q?, category?)`: 模板列表 (搜索 + 分类筛选)
- `clone(userId, templateId)`: 克隆为新项目 (复制 nodes/edges，ID 加前缀)
- `publish(userId, projectId, category, tags)`: 发布为模板
- `unpublish(userId, templateId)`: 取消发布

**端点**:
- `GET /api/v1/templates/`
- `POST /api/v1/templates/{id}/clone`
- `POST /api/v1/projects/{id}/publish`
- `DELETE /api/v1/templates/{id}`

### 4.10 邀请模块 (InvitationsModule)

**实体**: ProjectInvitation, ProjectCollaborator

**服务**:
- `createInvitation(userId, projectId, inviteeIdentifier, permission)`: 创建邀请
- `acceptInvitation(token, userId)`: 接受邀请 (创建 ProjectCollaborator)
- `listCollaborators(userId, projectId)`: 协作者列表
- `removeCollaborator(userId, projectId, collaboratorId)`: 移除协作者

**端点**:
- `POST /api/v1/projects/{id}/invitations`
- `GET /api/v1/projects/{id}/collaborators`
- `DELETE /api/v1/projects/{id}/collaborators/{collaboratorId}`
- `POST /api/v1/invitations/{token}/accept`

### 4.11 协作模块 (CollaborationModule - HTTP)

**服务**:
- `getStatus()`: 协作服务状态检查

**端点**:
- `GET /api/v1/collab/status`

## 5. 异步任务 (BullMQ)

### 5.1 队列架构

使用 BullMQ 替代 Celery，基于 Redis (复用现有 Redis 实例):

```typescript
// src/queue/queue.module.ts
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: { url: config.get('redis.url') },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: 'render-tasks' },  // 渲染/AI 推理任务队列
    ),
  ],
  providers: [RenderProcessor, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
```

### 5.2 任务处理器 (RenderProcessor)

```typescript
@Processor('render-tasks', { concurrency: 5 })
export class RenderProcessor {
  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    private aiService: AiService,
    private minioService: MinioService,
  ) {}

  @Process()
  async handleRenderTask(job: Job<{ taskId: string }>) {
    const { taskId } = job.data;

    // 1. 查询任务详情
    const task = await this.taskRepo.findOne({ where: { id: taskId } });

    // 2. 按 task_type 路由
    if (task.taskType.startsWith('ai_')) {
      await this.executeAiTask(task, job);
    } else {
      await this.executeRenderTask(task, job);
    }
  }

  // AI 任务执行 (路由到不同 API)
  private async executeAiTask(task: RenderTask, job: Job) {
    // ai_text2img/ai_img2img → callImageGen (Images API)
    // 其他 → callLlm (Chat Completions API)
    // 进度更新: job.updateProgress(50)
    // 结果上传 MinIO + 更新 result_url
  }

  // 模拟渲染任务
  private async executeRenderTask(task: RenderTask, job: Job) {
    // 模拟进度更新 (0→100)
    // 生成结果文件 + 上传 MinIO
  }
}
```

### 5.3 队列服务 (QueueService)

```typescript
@Injectable()
export class QueueService {
  constructor(@InjectQueue('render-tasks') private renderQueue: Queue) {}

  async enqueueRenderTask(taskId: string): Promise<string> {
    const job = await this.renderQueue.add('render', { taskId });
    return job.id;  // BullMQ job ID 替代 celery_task_id
  }

  async cancelTask(jobId: string): Promise<void> {
    const job = await this.renderQueue.getJob(jobId);
    if (job) {
      await job.discard();
      await job.remove();
    }
  }
}
```

### 5.4 关键兼容性

| 现有 (Celery) | 新 (BullMQ) |
|---------------|-------------|
| `celery_task_id` (字符串) | BullMQ `job.id` (字符串) |
| `AsyncResult.revoke(terminate=True)` | `job.discard() + job.remove()` |
| `--without-mingle --without-gossip` | BullMQ 原生无此问题 |
| Celery 专用事件循环 + DB session | NestJS 共享 DI 容器 (无事件循环问题) |
| `progress` 0-100 整数 | `job.updateProgress(0-100)` |

**关键优势**: BullMQ 运行在 NestJS 进程内 (worker 模式)，共享 TypeORM 连接池，无需创建独立的事件循环和 DB session。

## 6. WebSocket 协作

### 6.1 Socket.IO 网关

使用 `@nestjs/platform-socket.io`，与前端 Socket.IO Client 完全兼容:

```typescript
@WebSocketGateway({
  namespace: '/',
  cors: { origin: config.cors.origins, credentials: true },
  transports: ['websocket'],
})
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // 连接鉴权 (从 query string 解析 JWT)
  async handleConnection(client: Socket) {
    const token = client.handshake.query.token as string;
    // 验证 JWT → 设置 client.data.userId/username
    // 失败则 disconnect
  }

  // 事件处理
  @SubscribeMessage('join_project')
  async handleJoinProject(client: Socket, payload: { project_id: string }) {
    // 加入房间 → 返回在线用户快照 + 活跃锁列表
    // 广播 user_joined 事件
  }

  @SubscribeMessage('node_update')
  async handleNodeUpdate(client: Socket, payload: any) {
    // 仅广播 (不写 DB) + 锁校验
    // action=delete 时 pop 锁并广播 lock_changed(node_id, null)
  }

  @SubscribeMessage('acquire_lock')
  async handleAcquireLock(client: Socket, payload: { project_id: string; node_id: string }) {
    // 获取节点锁 → ack 返回 { ok: boolean, lock?: NodeLock }
    // 广播 lock_changed 事件
  }
}
```

### 6.2 节点锁服务 (NodeLockService)

完整迁移现有租约模型:

```typescript
@Injectable()
export class NodeLockService {
  private locks: Map<string, NodeLock> = new Map();  // key = `${projectId}:${nodeId}`

  private readonly LOCK_TTL = 5.0;           // 锁存活时长 (秒)
  private readonly RENEW_INTERVAL = 2.0;     // 续租间隔
  private readonly CLEANUP_INTERVAL = 1.0;   // 清理扫描间隔

  acquireLock(projectId: string, nodeId: string, sid: string, userId: string, username: string): NodeLock | null;
  renewLock(projectId: string, nodeId: string, sid: string): boolean;
  releaseLock(projectId: string, nodeId: string, sid: string): boolean;
  forceRelease(projectId: string, nodeId: string): boolean;  // owner 强制释放
  getActiveLocks(projectId: string): NodeLock[];
  startCleanupLoop(): void;  // TTL 清理协程 (每 1 秒扫描)
  purgeSidLocks(sid: string): NodeLock[];  // 断线清理
}
```

### 6.3 锁事件协议 (完全兼容现有前端)

| 事件 | 方向 | Payload |
|------|------|---------|
| `acquire_lock` | 客户端→服务端 | `{ project_id, node_id }` → ack `{ ok, lock? }` |
| `renew_lock` | 客户端→服务端 | `{ project_id, node_id }` → ack `{ ok }` |
| `release_lock` | 客户端→服务端 | `{ project_id, node_id }` |
| `force_release` | 客户端→服务端 | `{ project_id, node_id }` (owner only) |
| `lock_changed` | 服务端→客户端 | `{ node_id, lock }` (lock=null 表示释放) |
| `join_project` | 双向 | ack 返回 `{ users, locks }` (活跃锁全量同步) |

### 6.4 权限校验

```typescript
// 复用现有 _check_edit_permission 逻辑
private async checkEditPermission(userId: string, projectId: string): Promise<boolean> {
  // 1. 查询 Project.owner_id == userId → owner (可 force_release)
  // 2. 查询 ProjectCollaborator.permission in ['owner', 'editor'] → 可编辑
  // 3. viewer → 不可获锁
}
```

### 6.5 现有 WebSocket 事件兼容

| 事件 | 方向 | 说明 |
|------|------|------|
| `connect` | 客户端→服务端 | 建立连接 (JWT 鉴权，query string 传 token) |
| `disconnect` | 客户端→服务端 | 断开连接 (清理该 sid 所有锁) |
| `join_project` | 双向 | 加入项目协作房间 (ack 返回在线用户快照 + 活跃锁) |
| `leave_project` | 双向 | 离开项目协作房间 |
| `node_update` | 双向 | 节点变更广播 (仅广播不写 DB) |
| `edge_update` | 双向 | 边变更广播 (仅广播不写 DB) |
| `cursor_move` | 双向 | 远端光标移动 |
| `user_joined/user_left` | 服务端→客户端 | 房间成员变更广播 |
| `ping/pong` | 双向 | 心跳/延迟检测 |

## 7. API 兼容性

### 7.1 路由路径

所有路由严格保持 `/api/v1` 前缀，路径与现有完全一致:

```typescript
// src/app.module.ts
@Module({
  imports: [
    AuthModule,           // /api/v1/auth/*
    ProjectsModule,       // /api/v1/projects/*
    WorkflowsModule,      // /api/v1/workflows/*
    MediaModule,          // /api/v1/media/*
    RenderModule,         // /api/v1/render/*
    AiModule,             // /api/v1/ai/*
    SnapshotsModule,      // /api/v1/projects/{id}/snapshots + /api/v1/snapshots/{id}
    TemplatesModule,      // /api/v1/templates/* + /api/v1/projects/{id}/publish
    InvitationsModule,    // /api/v1/projects/{id}/invitations + /api/v1/invitations/{token}
    CollaborationModule,  // /api/v1/collab/status
    QueueModule,          // BullMQ (无 HTTP 端点)
    WsModule,             // Socket.IO /socket.io/
  ],
})
export class AppModule {}
```

### 7.2 响应格式

**成功响应**: 直接返回数据 (与 FastAPI 一致，不包装 `{ data: ... }`)

**错误响应**: 保持 FastAPI 格式 `{ detail: string }`

### 7.3 关键业务逻辑迁移

**datetime.utcnow() 约束**:
- 现有: Python `datetime.utcnow()` (TIMESTAMP WITHOUT TIME ZONE)
- 新: TypeORM `@UpdateDateColumn` 自动管理，或手动 `new Date()` (UTC)

**UUID 处理**:
- 现有: Python `uuid.UUID(user)` 转换
- 新: TypeScript 直接使用字符串 (TypeORM uuid 类型自动处理)

**工作流保存顺序**:
- 先 flush 节点再插边 (避免外键约束冲突) — 使用 TypeORM 事务:

```typescript
async saveWorkflow(projectId: string, nodes: any[], edges: any[]) {
  await this.dataSource.transaction(async (manager) => {
    // 1. 删除现有 nodes + edges
    await manager.delete(WorkflowEdge, { projectId });
    await manager.delete(WorkflowNode, { projectId });
    // 2. 插入新 nodes (flush)
    await manager.insert(WorkflowNode, nodes);
    // 3. 插入新 edges
    await manager.insert(WorkflowEdge, edges);
  });
}
```

**项目级联删除**:

```typescript
async deleteProject(userId: string, projectId: string) {
  await this.dataSource.transaction(async (manager) => {
    // 按依赖顺序删除: edges → nodes → snapshots → render_tasks → media_assets → project
    await manager.delete(WorkflowEdge, { projectId });
    await manager.delete(WorkflowNode, { projectId });
    await manager.delete(ProjectSnapshot, { projectId });
    await manager.delete(RenderTask, { projectId });
    await manager.delete(MediaAsset, { projectId });
    await manager.delete(Project, { id: projectId, ownerId: userId });
  });
}
```

**进度值存储**:
- `render_tasks.progress` 为 0-100 整数 (非 0.0-1.0)

**任务类型路由**:
- `ai_*` 前缀走 AI 推理 (`ai_text2img`/`ai_img2img` 走 Images API，其他走 Chat Completions API)
- 无前缀走模拟渲染

## 8. 测试策略

### 8.1 单元测试 (Jest)

- Service 层: Mock Repository 测试业务逻辑
- Processor: Mock BullMQ Job 测试任务处理
- Gateway: Mock Socket.IO Client 测试事件处理
- NodeLockService: 测试锁获取/续租/释放/TTL/断线清理

### 8.2 集成测试 (supertest)

- API 端到端测试: 注册→登录→创建项目→添加节点→执行任务
- API 兼容性验证: 对比新旧后端响应

### 8.3 测试文件结构

```
test/
├── unit/
│   ├── auth.service.spec.ts
│   ├── project.service.spec.ts
│   ├── render.processor.spec.ts
│   ├── node-lock.service.spec.ts
│   └── ai.service.spec.ts
├── e2e/
│   ├── auth.e2e-spec.ts
│   ├── projects.e2e-spec.ts
│   ├── workflows.e2e-spec.ts
│   └── api-compat.e2e-spec.ts  # API 兼容性验证
└── jest-e2e.json
```

## 9. 实施阶段划分

| 阶段 | 内容 | 交付物 |
|------|------|--------|
| Phase 1 | 项目脚手架 + ConfigModule + DatabaseModule + AuthModule + 通用工具 | 可启动的 NestJS 应用 + JWT 认证 |
| Phase 2 | Projects + Workflows + Media + Render + AI + Snapshots + Templates + Invitations + Collaboration | 所有业务 API 可用 |
| Phase 3 | BullMQ 队列 + RenderProcessor + Socket.IO 网关 + NodeLockService | 异步任务 + 实时协作 |
| Phase 4 | 单元测试 + 集成测试 + API 兼容性验证 | 测试覆盖 + 验证报告 |

## 10. 约束与注意事项

### 10.1 必须遵守的硬约束

1. **API 完全兼容**: 路径、请求/响应格式、状态码与 FastAPI 完全一致
2. **复用现有 Schema**: TypeORM `synchronize: false`，不修改表结构
3. **JWT 兼容**: payload 使用 `sub` 字段，与现有 FastAPI 生成的 Token 兼容
4. **错误消息中文**: 所有面向用户的错误消息使用纯中文
5. **进度值整数**: `render_tasks.progress` 为 0-100 整数
6. **工作流保存顺序**: 先 flush 节点再插边
7. **项目级联删除**: 按依赖顺序删除关联数据
8. **节点锁租约模型**: TTL=5.0s，续租间隔=2.0s，清理间隔=1.0s
9. **锁事件协议**: 4 个锁事件 + lock_changed 广播，与现有前端兼容
10. **viewer 不可获锁**: 复用权限校验逻辑

### 10.2 已知风险

1. **JWT Token 兼容性**: 需要确保 NestJS 生成的 JWT 与 FastAPI 生成的 Token 可以互相验证 (相同的 secret + algorithm)
2. **Socket.IO 协议兼容性**: 需要验证 NestJS Socket.IO Gateway 与前端 Socket.IO Client 的事件格式完全一致
3. **BullMQ 任务可靠性**: 需要验证 BullMQ 的任务重试、超时、取消机制是否满足业务需求
4. **TypeORM JSONB 处理**: 需要验证 TypeORM 对 JSONB 字段的读写是否与 SQLAlchemy 一致

### 10.3 不在范围内

1. **前端修改**: 前端无需任何修改 (API 完全兼容)
2. **数据库迁移**: 不创建新的 Alembic 迁移脚本，复用现有 schema
3. **旧后端删除**: 新后端验证通过后再删除旧 FastAPI 后端
4. **性能优化**: 本次重构以功能对等为优先，性能优化后续进行
