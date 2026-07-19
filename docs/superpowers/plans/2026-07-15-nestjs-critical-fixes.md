# NestJS Critical 问题修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 NestJS vs Python 后端对比报告中的 18 个 Critical 问题，使 NestJS 后端在数据库 schema、API 路由、服务层逻辑、异步任务、WebSocket 五大维度与 Python 后端功能对齐。

**Architecture:** 沿用现有 NestJS + TypeORM + BullMQ + Socket.IO 架构，按优先级分 4 批修复：① 阻塞核心功能 ② 安全/数据完整性 ③ API 兼容性 ④ AI 服务兼容性。所有修复保持 `synchronize: false`，复用 Python 主导的 DB schema，不改 DB。

**Tech Stack:** NestJS 10.x, TypeORM 0.3.x, BullMQ, Socket.IO, axios, fluent-ffmpeg（新增依赖）

## Global Constraints

- 分支：`refactor/nestjs-backend`，沿用现有工作树
- 数据库 schema 主导方为 Python 后端，NestJS `synchronize: false`，**不修改 DB schema**
- 所有响应字段使用 snake_case（与 Python FastAPI 兼容）
- 错误响应统一 `{ detail: string }`（FastApiCompatFilter 已实现）
- git commit 使用简短中文描述
- 每个 Task 完成后运行 `npx tsc --noEmit` 验证 TS 编译通过
- AI 服务移植以 Python `backend/app/services/ai_service.py` 为真相源（文件路径见各 Task）

## 参考文件位置

**Python 真相源（只读参考）：**
- `backend/app/models/user.py` — User 模型（无 created_at）
- `backend/app/services/ai_service.py` — AI 服务完整实现
- `backend/app/services/export_service.py` — FFmpeg 合成
- `backend/app/tasks/render_tasks.py` — 渲染任务
- `backend/app/api/{ai,media,workflows,render,collaboration}.py` — API 路由
- `backend/app/ws/collaboration.py` — WebSocket 协作

**NestJS 修改目标：**
- `backend_nest/src/modules/auth/entities/user.entity.ts`
- `backend_nest/src/modules/collaboration/collaboration.controller.ts`
- `backend_nest/src/ws/{node-lock.service.ts,collaboration.gateway.ts}`
- `backend_nest/src/modules/workflows/workflows.service.ts`
- `backend_nest/src/modules/media/{media.controller.ts,media.service.ts}`
- `backend_nest/src/modules/render/render.service.ts`
- `backend_nest/src/queue/{render.processor.ts,queue.service.ts}`
- `backend_nest/src/modules/ai/{ai.service.ts,ai.controller.ts,dto/ai.dto.ts}`

---

## Task 1: 修复 C1 — User 实体移除 created_at 字段

**问题：** Python `User` 模型无 `created_at` 列，DB 也不存在此列。NestJS `user.entity.ts:11` 声明了 `@CreateDateColumn({ name: 'created_at' })`，导致 TypeORM SELECT/INSERT 包含 `created_at` → PostgreSQL 报 `column does not exist` → 所有用户接口（登录/注册/刷新）失败。

**Files:**
- Modify: `backend_nest/src/modules/auth/entities/user.entity.ts`

**Interfaces:**
- Consumes: 无
- Produces: `User` 实体与 DB schema 完全对齐（4 列：id, username, email, hashed_password, avatar_url）

- [ ] **Step 1: 修改 User 实体**

替换 `backend_nest/src/modules/auth/entities/user.entity.ts` 全部内容：

```typescript
// src/modules/auth/entities/user.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 64, unique: true }) username: string;
  @Column({ length: 255, unique: true }) email: string;
  @Column({ name: 'hashed_password', length: 255 }) hashedPassword: string;
  @Column({ name: 'avatar_url', length: 512, nullable: true }) avatarUrl: string;
}
```

- [ ] **Step 2: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add backend_nest/src/modules/auth/entities/user.entity.ts
git commit -m "fix: 移除User实体created_at字段(DB无此列导致用户接口全失败)"
```

---

## Task 2: 修复 C2 + C19 + I-33 — WebSocket 协作模块三项修复

**问题：**
- **C2** Python `GET /api/v1/status`，NestJS `GET /api/v1/collab/status` → 路由不兼容
- **C19** Python TTL 清理协程清理后广播 `lock_changed`，NestJS `NodeLockService.purgeExpiredLocks` 仅删除不广播 → 前端锁状态永久不同步
- **I-33** Python `node_update`/`edge_update` 校验编辑权限（拒绝 viewer），NestJS 不校验 → viewer 可广播

**Files:**
- Modify: `backend_nest/src/modules/collaboration/collaboration.controller.ts`
- Modify: `backend_nest/src/ws/node-lock.service.ts`
- Modify: `backend_nest/src/ws/collaboration.gateway.ts`
- Modify: `backend_nest/src/ws/ws.module.ts`

**Interfaces:**
- Consumes: `InvitationsService.checkEditPermission(userId, projectId)` 已存在
- Produces: `NodeLockService.purgeExpiredLocks()` 返回被清理锁列表（供 Gateway 广播）

- [ ] **Step 1: 修复 C2 — 协作状态路由路径**

替换 `backend_nest/src/modules/collaboration/collaboration.controller.ts` 全部内容：

```typescript
// src/modules/collaboration/collaboration.controller.ts
import { Controller, Get } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';

@Controller()
export class CollaborationController {
  constructor(private collaborationService: CollaborationService) {}

  @Get('status')
  getStatus() {
    return this.collaborationService.getStatus();
  }
}
```

注意：`@Controller()` 无参数 → 路由为 `/api/v1/status`（与 Python `collaboration.py:23` 一致）。

- [ ] **Step 2: 修复 C19 — NodeLockService 暴露清理接口供 Gateway 订阅**

修改 `backend_nest/src/ws/node-lock.service.ts`：

在 `purgeExpiredLocks` 方法之前添加注释，并将方法改为 public（已是 public），保留返回值。同时新增一个回调注册机制：

替换 `node-lock.service.ts` 中 `@Injectable()` 装饰器至文件末尾的全部内容：

```typescript
@Injectable()
export class NodeLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NodeLockService');
  private locks: Map<string, NodeLock> = new Map();
  private cleanupListeners: Array<(locks: NodeLock[]) => void> = [];

  private readonly LOCK_TTL = 5.0;
  private readonly CLEANUP_INTERVAL = 1.0;
  private cleanupTimer: NodeJS.Timeout;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      this.purgeExpiredLocks();
    }, this.CLEANUP_INTERVAL * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /** 注册清理监听器，TTL 过期清理后会被调用（用于广播 lock_changed） */
  onLocksPurged(listener: (locks: NodeLock[]) => void): void {
    this.cleanupListeners.push(listener);
  }

  private lockKey(projectId: string, nodeId: string): string {
    return `${projectId}:${nodeId}`;
  }

  private isExpired(lock: NodeLock, now?: number): boolean {
    const t = now ?? Date.now() / 1000;
    return t >= lock.expiresAt;
  }

  acquireLock(
    projectId: string, nodeId: string, sid: string, userId: string, username: string,
  ): NodeLock | null {
    const key = this.lockKey(projectId, nodeId);
    const existing = this.locks.get(key);

    if (existing && !this.isExpired(existing)) {
      if (existing.sid === sid) {
        return this.renew(projectId, nodeId, sid);
      }
      return null;
    }

    const now = Date.now() / 1000;
    const lock: NodeLock = {
      nodeId, projectId, sid, userId, username,
      acquiredAt: now, expiresAt: now + this.LOCK_TTL, lastRenewed: now,
    };
    this.locks.set(key, lock);
    return lock;
  }

  renew(projectId: string, nodeId: string, sid: string): NodeLock | null {
    const key = this.lockKey(projectId, nodeId);
    const lock = this.locks.get(key);
    if (!lock || lock.sid !== sid || this.isExpired(lock)) {
      if (lock) this.locks.delete(key);
      return null;
    }
    const now = Date.now() / 1000;
    lock.lastRenewed = now;
    lock.expiresAt = now + this.LOCK_TTL;
    return lock;
  }

  release(projectId: string, nodeId: string, sid: string): boolean {
    const key = this.lockKey(projectId, nodeId);
    const lock = this.locks.get(key);
    if (!lock || lock.sid !== sid) return false;
    this.locks.delete(key);
    return true;
  }

  forceRelease(projectId: string, nodeId: string): boolean {
    const key = this.lockKey(projectId, nodeId);
    return this.locks.delete(key);
  }

  getActiveLocks(projectId: string): NodeLock[] {
    const result: NodeLock[] = [];
    for (const [key, lock] of this.locks) {
      if (lock.projectId === projectId && !this.isExpired(lock)) {
        result.push(lock);
      }
    }
    return result;
  }

  getLock(projectId: string, nodeId: string): NodeLock | null {
    const key = this.lockKey(projectId, nodeId);
    const lock = this.locks.get(key);
    if (!lock || this.isExpired(lock)) {
      if (lock) this.locks.delete(key);
      return null;
    }
    return lock;
  }

  purgeSidLocks(sid: string): NodeLock[] {
    const removed: NodeLock[] = [];
    for (const [key, lock] of this.locks) {
      if (lock.sid === sid) {
        removed.push(lock);
        this.locks.delete(key);
      }
    }
    return removed;
  }

  popLock(projectId: string, nodeId: string): NodeLock | null {
    const key = this.lockKey(projectId, nodeId);
    const lock = this.locks.get(key);
    this.locks.delete(key);
    return lock || null;
  }

  /** 清理所有过期锁并通知监听器（用于广播 lock_changed） */
  purgeExpiredLocks(): NodeLock[] {
    const now = Date.now() / 1000;
    const expired: NodeLock[] = [];
    for (const [key, lock] of this.locks) {
      if (this.isExpired(lock, now)) {
        expired.push(lock);
        this.locks.delete(key);
      }
    }
    if (expired.length > 0) {
      this.logger.debug(`清理过期锁: ${expired.length} 个`);
      // 通知所有监听器（Gateway 用于广播 lock_changed）
      for (const listener of this.cleanupListeners) {
        try {
          listener(expired);
        } catch (err) {
          this.logger.warn(`清理监听器执行失败: ${(err as Error).message}`);
        }
      }
    }
    return expired;
  }

  lockToDict(lock: NodeLock): any {
    return {
      node_id: lock.nodeId,
      project_id: lock.projectId,
      sid: lock.sid,
      user_id: lock.userId,
      username: lock.username,
      acquired_at: lock.acquiredAt,
      expires_at: lock.expiresAt,
    };
  }
}
```

注意：在 class 定义上方添加 `import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';`，移除原 `OnModuleInit` 单独导入。

- [ ] **Step 3: 修复 C19 + I-33 — Gateway 注册清理监听器 + 权限校验**

修改 `backend_nest/src/ws/collaboration.gateway.ts`：

在 `constructor` 末尾添加清理监听器注册（在 `}` 之前插入）：

```typescript
  constructor(
    private config: ConfigService,
    private jwtService: JwtService,
    private nodeLockService: NodeLockService,
    private invitationsService: InvitationsService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    // C19: 注册 TTL 清理监听器，清理后广播 lock_changed（对齐 Python _lock_cleanup_loop）
    this.nodeLockService.onLocksPurged((expiredLocks) => {
      for (const lock of expiredLocks) {
        this.broadcastLockChanged(lock.projectId, lock.nodeId, null);
      }
    });
  }
```

修改 `handleNodeUpdate` 方法，添加权限校验（对齐 Python `collaboration.py:337-340`）：

```typescript
  @SubscribeMessage('node_update')
  async handleNodeUpdate(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    const { project_id, node_id, action } = payload;
    const { userId } = client.data;

    // I-33: 权限检查（viewer 不可编辑）
    const { canEdit } = await this.invitationsService.checkEditPermission(userId, project_id);
    if (!canEdit) {
      client.emit('error', { message: '查看者无法编辑' });
      return;
    }

    const room = `project:${project_id}`;

    if (action === 'delete') {
      const lock = this.nodeLockService.popLock(project_id, node_id);
      if (lock) {
        this.broadcastLockChanged(project_id, node_id, null);
      }
    }

    client.to(room).emit('node_update', payload);
  }
```

修改 `handleEdgeUpdate` 方法，添加权限校验：

```typescript
  @SubscribeMessage('edge_update')
  async handleEdgeUpdate(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    const { project_id } = payload;
    const { userId } = client.data;

    // I-33: 权限检查（viewer 不可编辑）
    const { canEdit } = await this.invitationsService.checkEditPermission(userId, project_id);
    if (!canEdit) {
      client.emit('error', { message: '查看者无法编辑' });
      return;
    }

    const room = `project:${project_id}`;
    client.to(room).emit('edge_update', payload);
  }
```

- [ ] **Step 4: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add backend_nest/src/modules/collaboration/collaboration.controller.ts \
        backend_nest/src/ws/node-lock.service.ts \
        backend_nest/src/ws/collaboration.gateway.ts
git commit -m "fix: 修复WebSocket协作模块3项问题(状态路由/TTL清理广播/编辑权限校验)"
```

---

## Task 3: 修复 C3 + C14 — 工作流响应时间戳 + 删除节点顺序

**问题：**
- **C3** Python `create_node`/`list_edges`/`create_edge` 返回 `created_at`/`updated_at`，NestJS `nodeToResponse`/`edgeToResponse`/`listEdges` 不含时间戳
- **C14** Python `delete_node` 先删边后删节点，NestJS 先删节点后删边 → FK 违约风险

**Files:**
- Modify: `backend_nest/src/modules/workflows/workflows.service.ts`

**Interfaces:**
- Consumes: 无
- Produces: `nodeToResponse`/`edgeToResponse` 返回包含 `created_at`/`updated_at`

- [ ] **Step 1: 修复 C14 — 删除节点顺序（先删边后删节点）**

修改 `backend_nest/src/modules/workflows/workflows.service.ts` 的 `deleteNode` 方法：

```typescript
  async deleteNode(projectId: string, userId: string, nodeId: string) {
    await this.verifyProjectOwner(projectId, userId);
    // C14: 先删关联边，再删节点（避免 FK 违约，对齐 Python workflows.py:119-128）
    await this.edgeRepo.delete([
      { sourceNodeId: nodeId, projectId },
      { targetNodeId: nodeId, projectId },
    ]);
    const result = await this.nodeRepo.delete({ id: nodeId, projectId });
    if (result.affected === 0) throw new NotFoundException('节点不存在');
  }
```

- [ ] **Step 2: 修复 C3 — 响应补充时间戳字段**

修改 `listEdges` 方法（添加 `created_at`/`updated_at`）：

```typescript
  async listEdges(projectId: string, userId: string) {
    await this.verifyProjectOwner(projectId, userId);
    const edges = await this.edgeRepo.find({ where: { projectId } });
    return edges.map(e => ({
      id: e.id,
      project_id: e.projectId,
      source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId,
      source_port: e.sourcePort,
      target_port: e.targetPort,
      created_at: e.createdAt?.toISOString(),
      updated_at: e.updatedAt?.toISOString(),
    }));
  }
```

修改 `nodeToResponse` 和 `edgeToResponse` 方法（添加时间戳）：

```typescript
  private nodeToResponse(n: WorkflowNode) {
    return {
      id: n.id, project_id: n.projectId, node_type: n.nodeType, label: n.label,
      position_x: n.positionX, position_y: n.positionY, config: n.config,
      created_at: n.createdAt?.toISOString(),
      updated_at: n.updatedAt?.toISOString(),
    };
  }

  private edgeToResponse(e: WorkflowEdge) {
    return {
      id: e.id, project_id: e.projectId, source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId, source_port: e.sourcePort, target_port: e.targetPort,
      created_at: e.createdAt?.toISOString(),
      updated_at: e.updatedAt?.toISOString(),
    };
  }
```

注意：`createNode` 调用 `this.nodeRepo.save(node)` 后，`node.createdAt`/`node.updatedAt` 由 TypeORM `@CreateDateColumn`/`@UpdateDateColumn` 自动填充。但 `save` 返回的对象可能不包含这些字段，需要 `refresh`。修改 `createNode` 和 `createEdge`，在 save 后重新查询：

```typescript
  async createNode(projectId: string, userId: string, dto: NodeCreateDto) {
    await this.verifyProjectOwner(projectId, userId);
    const node = this.nodeRepo.create({
      id: dto.id,
      projectId,
      nodeType: dto.node_type,
      label: dto.label,
      positionX: dto.position_x,
      positionY: dto.position_y,
      config: dto.config,
    });
    await this.nodeRepo.save(node);
    // 重新查询以获取 created_at/updated_at（@CreateDateColumn 在 save 后可能未填充）
    const saved = await this.nodeRepo.findOne({ where: { id: dto.id } });
    return this.nodeToResponse(saved || node);
  }
```

同样修改 `createEdge`：

```typescript
  async createEdge(projectId: string, userId: string, dto: EdgeCreateDto) {
    await this.verifyProjectOwner(projectId, userId);
    const edge = this.edgeRepo.create({
      id: dto.id,
      projectId,
      sourceNodeId: dto.source_node_id,
      targetNodeId: dto.target_node_id,
      sourcePort: dto.source_port,
      targetPort: dto.target_port,
    });
    await this.edgeRepo.save(edge);
    const saved = await this.edgeRepo.findOne({ where: { id: dto.id } });
    return this.edgeToResponse(saved || edge);
  }
```

- [ ] **Step 3: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add backend_nest/src/modules/workflows/workflows.service.ts
git commit -m "fix: 修复工作流模块2项问题(响应补充时间戳/删除节点改先删边后删节点)"
```

---

## Task 4: 修复 C4 + C6 + C7 — 渲染导出所有权 + 媒体下载 inline + presign expires_in

**问题：**
- **C4** Python `render.py:260` 校验项目所有权，NestJS `render.service.ts:164 exportVideo` 无校验
- **C6** Python `media.py:137` 支持 `?download=true/false`（默认 inline），NestJS `media.controller.ts:53` 恒 attachment
- **C7** Python 返回 `{url, expires_in: 3600}`，NestJS `media.service.ts:78` 仅返回 `{url}`

**Files:**
- Modify: `backend_nest/src/modules/render/render.service.ts`
- Modify: `backend_nest/src/modules/render/render.controller.ts` (可选，校验路径)
- Modify: `backend_nest/src/modules/media/media.controller.ts`
- Modify: `backend_nest/src/modules/media/media.service.ts`

**Interfaces:**
- Consumes: `Project` 实体（已在 render.module 中注入）
- Produces: `MediaService.getPresign` 返回 `{ url, expires_in }`；`MediaController.download` 支持 `?download=` 参数

- [ ] **Step 1: 修复 C4 — 导出视频添加项目所有权校验**

修改 `backend_nest/src/modules/render/render.service.ts`：

在 `constructor` 参数中添加 `Project` 仓库注入（若未注入）：

```typescript
import { Project } from '../projects/entities/project.entity';

@Injectable()
export class RenderService {
  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private dataSource: DataSource,
    private queueService: QueueService,
  ) {}
```

修改 `exportVideo` 方法开头（添加所有权校验）：

```typescript
  async exportVideo(userId: string, dto: ExportRequestDto) {
    // C4: 项目所有权校验（对齐 Python render.py:260-262）
    const project = await this.projectRepo.findOne({ where: { id: dto.project_id } });
    if (!project || project.ownerId !== userId) {
      throw new NotFoundException('项目不存在');
    }

    // 从最新快照获取 timeline_data
    const snapshotRows = await this.dataSource.query(
      `SELECT snapshot_data FROM project_snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [dto.project_id],
    );
    // ...（后续代码保持不变）
```

修改 `render.module.ts` 添加 `Project` 到 `forFeature`（若未添加）：

```typescript
import { Project } from '../projects/entities/project.entity';
// ...
TypeOrmModule.forFeature([RenderTask, Project]),
```

- [ ] **Step 2: 修复 C7 — presign 返回 expires_in**

修改 `backend_nest/src/modules/media/media.service.ts` 的 `getPresign` 方法：

```typescript
  async getPresign(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权访问此资产');
    const url = await this.minioService.getPresignedUrl(media.storageKey, 1);
    return { url, expires_in: 3600 };
  }
```

- [ ] **Step 3: 修复 C6 — 下载支持 inline 模式**

修改 `backend_nest/src/modules/media/media.controller.ts` 的 `download` 方法：

```typescript
  @UseGuards(OptionalTokenGuard)
  @Get(':id/download')
  async download(
    @CurrentUser() userId: string,
    @Param('id') mediaId: string,
    @Query('download') download: string,
    @Res() res: any,
  ) {
    const result = await this.mediaService.download(userId, mediaId);
    // C6: download=true 强制下载(attachment)，否则 inline（对齐 Python media.py:165）
    const disposition = download === 'true' ? 'attachment' : 'inline';
    const encodedFilename = encodeURIComponent(result.fileName);
    res.set('Content-Type', result.contentType);
    res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedFilename}`);
    res.send(result.buffer);
  }
```

- [ ] **Step 4: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add backend_nest/src/modules/render/render.service.ts \
        backend_nest/src/modules/render/render.module.ts \
        backend_nest/src/modules/media/media.service.ts \
        backend_nest/src/modules/media/media.controller.ts
git commit -m "fix: 修复渲染导出所有权校验+媒体下载inline模式+presign返回expires_in"
```

---

## Task 5: 修复 C5 + C15 — AI Provider 级联删除 + 模型归属验证

**问题：**
- **C5** Python `ai.py:148-168` 级联删除关联模型，NestJS `ai.service.ts:52-57` 拒绝删除有关联模型的 Provider
- **C15** Python `_get_provider_and_model` 校验 `expected_type` + `is_active`，NestJS 不校验 → 允许用 LLM 调图片生成、允许调用禁用模型

**Files:**
- Modify: `backend_nest/src/modules/ai/ai.service.ts`

**Interfaces:**
- Consumes: 无
- Produces: `deleteProvider` 级联删除；`getProviderAndModel` 支持 `expectedType` 参数

- [ ] **Step 1: 修复 C5 — Provider 级联删除**

修改 `backend_nest/src/modules/ai/ai.service.ts` 的 `deleteProvider` 方法：

```typescript
  async deleteProvider(userId: string, providerId: string) {
    // C5: 级联删除关联模型（对齐 Python ai.py:148-168）
    const provider = await this.providerRepo.findOne({ where: { id: providerId, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');

    // 删除关联模型
    const models = await this.modelRepo.find({ where: { providerId } });
    if (models.length > 0) {
      await this.modelRepo.remove(models);
    }
    await this.providerRepo.remove(provider);
    return { message: `已删除 Provider 及其关联的 ${models.length} 个模型` };
  }
```

同时修改 `ai.controller.ts` 的 `deleteProvider`，返回 service 的结果而非 `{ detail: '已删除' }`：

```typescript
  @Delete('providers/:id')
  deleteProvider(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.aiService.deleteProvider(userId, id);
  }
```

- [ ] **Step 2: 修复 C15 — getProviderAndModel 添加类型 + is_active 校验**

修改 `ai.service.ts` 的 `getProviderAndModel` 私有方法：

```typescript
  private async getProviderAndModel(
    modelId: string,
    userId: string,
    expectedType?: string,
  ): Promise<{ provider: AiProvider; model: AiModel }> {
    const model = await this.modelRepo.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('AI 模型不存在');

    // C15: 校验 model_type（对齐 Python ai_service.py:42-46）
    if (expectedType && model.modelType !== expectedType) {
      throw new ConflictException(
        `模型 ${model.displayName} 类型为 ${model.modelType}，期望 ${expectedType}。请在设置页配置 ${expectedType} 类型的模型。`,
      );
    }

    const provider = await this.providerRepo.findOne({ where: { id: model.providerId, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');

    // C15: 校验 is_active（对齐 Python ai_service.py:57-58）
    if (!provider.isActive || !model.isActive) {
      throw new ConflictException('AI Provider/Model 已禁用');
    }

    return { provider, model };
  }
```

修改所有调用 `getProviderAndModel` 的方法，传入 `expectedType`：

`callLlm`:
```typescript
  async callLlm(modelId: string, messages: any[], userId: string, temperature = 0.7): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'llm');
    // ...（后续保持不变，body 添加 temperature）
    const body = {
      model: model.modelId,
      messages,
      temperature,
    };
    // ...
  }
```

`callImageGen`:
```typescript
  async callImageGen(modelId: string, params: any, userId: string): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'image_gen');
    // ...
  }
```

`callVideoGen`:
```typescript
  async callVideoGen(modelId: string, params: any, userId: string): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'video_gen');
    // ...
  }
```

`callAudioGen`:
```typescript
  async callAudioGen(modelId: string, params: any, userId: string): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'tts');
    // ...
  }
```

注意：`callLlm` 当前签名 `(modelId, messages, userId)`，添加 `temperature = 0.7` 默认参数，并在 body 中添加 `temperature` 字段（对齐 Python `ai_service.py:86`）。

- [ ] **Step 3: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add backend_nest/src/modules/ai/ai.service.ts backend_nest/src/modules/ai/ai.controller.ts
git commit -m "fix: 修复AI模块2项问题(Provider级联删除/模型归属校验类型+is_active)"
```

---

## Task 6: 修复 C8 — 实现完整 FFmpeg 视频导出合成

**问题：** Python `export_service.py:54-183` 完整 FFmpeg 多轨混流，NestJS `render.processor.ts:150-167` 仅模拟进度。

**Files:**
- Modify: `backend_nest/package.json` (添加 fluent-ffmpeg + @types/fluent-ffmpeg 依赖)
- Create: `backend_nest/src/queue/export.service.ts`
- Modify: `backend_nest/src/queue/render.processor.ts`
- Modify: `backend_nest/src/queue/queue.module.ts`

**Interfaces:**
- Consumes: `MinioService`（已有）、`RenderTask` 实体
- Produces: `ExportService.composeVideo(clips, format, resolution, duration, taskId, subtitles)` 返回 `Buffer`

**参考：** Python `backend/app/services/export_service.py:54-183`

- [ ] **Step 1: 安装 fluent-ffmpeg 依赖**

Run:
```bash
cd backend_nest && npm install fluent-ffmpeg @types/fluent-ffmpeg
```

注意：系统需安装 ffmpeg 二进制（部署环境 Dockerfile 需添加 `RUN apt-get update && apt-get install -y ffmpeg`）。

- [ ] **Step 2: 创建 ExportService**

创建 `backend_nest/src/queue/export.service.ts`：

```typescript
// src/queue/export.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { RenderTask } from '../modules/render/entities/render-task.entity';
import { MediaAsset } from '../modules/media/entities/media-asset.entity';
import { MinioService } from '../common/utils/minio.service';

export interface Clip {
  url: string;
  start: number;
  end: number;
  track_type: string;
  media_type: string;
}

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger('ExportService');

  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private minioService: MinioService,
  ) {}

  /**
   * 合成视频（对齐 Python export_service.py:54-183）
   * 返回输出文件的本地路径，调用方负责上传 MinIO 后清理
   */
  async composeVideo(
    clips: Clip[],
    outputFormat: string,
    resolution: string,
    duration: number,
    taskId: string,
    subtitles?: Subtitle[],
  ): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), `export_${taskId}_${uuidv4()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. 下载所有素材
    const localPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const ext = clip.media_type === 'video' ? '.mp4' : clip.media_type === 'image' ? '.png' : '.mp3';
      const localPath = await this.downloadToTemp(clip.url, tmpDir, `clip_${i}${ext}`);
      localPaths.push(localPath);

      // 更新进度（0-30%）
      await this.updateProgress(taskId, Math.floor((i + 1) / clips.length * 30));
    }

    // 2. 分辨率映射
    const resolutionMap: Record<string, string> = {
      '720p': '1280:720',
      '1080p': '1920:1080',
      '4k': '3840:2160',
    };
    const scale = resolutionMap[resolution] || '1920:1080';

    // 2.5 生成字幕 SRT 文件
    let subtitleFilter = '';
    if (subtitles && subtitles.length > 0) {
      const srtPath = path.join(tmpDir, 'subtitles.srt');
      this.writeSrtFile(srtPath, subtitles);
      subtitleFilter = `subtitles=${srtPath.replace(/:/g, '\\:')}:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2'`;
    }

    // 3. 构建 FFmpeg 命令
    const outputExt = ['mp4', 'mov', 'webm'].includes(outputFormat) ? outputFormat : 'mp4';
    const outputPath = path.join(tmpDir, `output.${outputExt}`);

    const videoClips = clips
      .map((c, i) => ({ clip: c, path: localPaths[i] }))
      .filter(({ clip }) => clip.track_type === 'video');

    return new Promise<string>((resolve, reject) => {
      const cmd = ffmpeg();

      if (videoClips.length === 0) {
        // 无视频片段，创建黑屏
        cmd.input(`color=c=black:s=${scale.replace(':', 'x')}:d=${duration}`).inputFormat('lavfi');
        let vf = `scale=${scale}`;
        if (subtitleFilter) vf += `,${subtitleFilter}`;
        cmd.videoFilters(vf).outputOptions(['-c:v libx264', `-t ${duration}`]);
      } else if (videoClips.length === 1) {
        // 单个视频片段，直接转码
        cmd.input(videoClips[0].path);
        let vf = `scale=${scale}`;
        if (subtitleFilter) vf += `,${subtitleFilter}`;
        cmd.videoFilters(vf).outputOptions(['-c:v libx264', '-c:a aac', `-t ${duration}`]);
      } else {
        // 多个视频片段，使用 concat
        const concatFile = path.join(tmpDir, 'concat.txt');
        const sortedClips = [...videoClips].sort((a, b) => (a.clip.start || 0) - (b.clip.start || 0));
        fs.writeFileSync(
          concatFile,
          sortedClips.map(({ path: p }) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
        );
        cmd.input(concatFile).inputFormat('concat').inputOptions(['-safe 0']);
        let vf = `scale=${scale}`;
        if (subtitleFilter) vf += `,${subtitleFilter}`;
        cmd.videoFilters(vf).outputOptions(['-c:v libx264', '-c:a aac', `-t ${duration}`]);
      }

      cmd
        .output(outputPath)
        .on('end', async () => {
          this.logger.log(`FFmpeg 合成完成: ${outputPath}`);
          await this.updateProgress(taskId, 90);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`FFmpeg 失败: ${err.message}`);
          reject(new Error(`FFmpeg failed: ${err.message}`));
        })
        .run();
    });
  }

  /** 上传导出结果到 MinIO 并创建 MediaAsset，返回 /api/v1/media/{id}/download */
  async uploadExportAndCreateAsset(
    localPath: string,
    taskId: string,
    ownerId: string,
    projectId: string,
  ): Promise<string> {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath);
    const objectName = `exports/${projectId}/${taskId}${ext}`;

    await this.minioService.uploadFile(objectName, buffer, 'video/mp4');

    const mediaAsset = this.mediaRepo.create({
      id: uuidv4(),
      ownerId,
      projectId,
      fileName: `export_${taskId}${ext}`,
      fileType: 'video/mp4',
      fileSize: buffer.length,
      storageKey: objectName,
    });
    await this.mediaRepo.save(mediaAsset);

    // 清理临时文件
    try {
      fs.unlinkSync(localPath);
      fs.rmdirSync(path.dirname(localPath));
    } catch (e) {
      this.logger.warn(`清理临时文件失败: ${(e as Error).message}`);
    }

    return `/api/v1/media/${mediaAsset.id}/download`;
  }

  private async downloadToTemp(url: string, tmpDir: string, filename: string): Promise<string> {
    const localPath = path.join(tmpDir, filename);

    // 处理内部 MinIO 路径 /api/v1/media/{id}/download
    if (url.startsWith('/api/v1/media/')) {
      const parts = url.replace(/^\//, '').split('/');
      const mediaId = parts[3] || parts[parts.length - 1].split('?')[0];
      const asset = await this.mediaRepo.findOne({ where: { id: mediaId } });
      if (asset) {
        const presignedUrl = await this.minioService.getPresignedUrl(asset.storageKey, 1);
        const resp = await axios.get(presignedUrl, { responseType: 'arraybuffer', timeout: 120000 });
        fs.writeFileSync(localPath, Buffer.from(resp.data));
        return localPath;
      }
    }

    // 外部 URL
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(localPath, Buffer.from(resp.data));
    return localPath;
  }

  private writeSrtFile(srtPath: string, subtitles: Subtitle[]): void {
    const lines: string[] = [];
    subtitles.forEach((sub, i) => {
      lines.push(String(i + 1));
      lines.push(`${this.formatSrtTime(sub.start)} --> ${this.formatSrtTime(sub.end)}`);
      lines.push(sub.text);
      lines.push('');
    });
    fs.writeFileSync(srtPath, lines.join('\n'), 'utf-8');
  }

  private formatSrtTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  private async updateProgress(taskId: string, progress: number): Promise<void> {
    try {
      await this.taskRepo.update(taskId, { progress });
    } catch (e) {
      this.logger.warn(`更新进度失败: ${(e as Error).message}`);
    }
  }
}
```

- [ ] **Step 3: 修改 RenderProcessor 的 executeExportTask**

修改 `backend_nest/src/queue/render.processor.ts`，添加 `ExportService` 注入并替换 `executeExportTask`：

在 constructor 添加：
```typescript
  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private aiService: AiService,
    private minioService: MinioService,
    private exportService: ExportService,
  ) {
    super();
  }
```

添加 import：`import { ExportService } from './export.service';`

替换 `executeExportTask` 方法：

```typescript
  // ── 导出任务（C8: 完整 FFmpeg 合成）──
  private async executeExportTask(
    task: RenderTask,
    job: Job,
    params: { nodeParams?: any },
  ) {
    const exportParams = params.nodeParams || task.nodeParams || {};
    const timelineData = exportParams.timeline_data || {};
    const tracks = timelineData.tracks || [];
    const duration = timelineData.duration || 30;

    // 从 tracks 收集所有 clip
    const clips: Clip[] = [];
    for (const track of tracks) {
      if (track.visible === false) continue;
      for (const clip of (track.clips || [])) {
        if (clip.mediaUrl) {
          clips.push({
            url: clip.mediaUrl,
            start: clip.start || 0,
            end: clip.end || 5,
            track_type: track.type || 'video',
            media_type: clip.mediaType || 'video',
          });
        }
      }
    }

    if (clips.length === 0) {
      throw new Error('时间轴上没有素材');
    }

    await job.updateProgress(10);

    // 调用 ExportService 合成视频
    const localPath = await this.exportService.composeVideo(
      clips,
      exportParams.format || 'mp4',
      exportParams.resolution || '1080p',
      duration,
      task.id,
      exportParams.subtitles,
    );

    await job.updateProgress(90);

    // 上传 MinIO + 创建 MediaAsset
    const resultUrl = await this.exportService.uploadExportAndCreateAsset(
      localPath, task.id, task.ownerId, task.projectId,
    );

    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
    await job.updateProgress(100);
  }
```

在文件顶部添加 `Clip` 类型 import：`import { ExportService, Clip } from './export.service';`

- [ ] **Step 4: 修改 QueueModule 提供 ExportService**

修改 `backend_nest/src/queue/queue.module.ts`：

```typescript
import { ExportService } from './export.service';
// ...
@Global()
@Module({
  imports: [
    // ...原有 imports...
    TypeOrmModule.forFeature([RenderTask, MediaAsset]),
    AuthModule,
    AiModule,
  ],
  providers: [QueueService, RenderProcessor, ExportService],
  exports: [QueueService, ExportService],
})
export class QueueModule {}
```

- [ ] **Step 5: 修改 Dockerfile 安装 ffmpeg**

修改 `backend_nest/Dockerfile`，在 builder 和 production 阶段都添加 ffmpeg 安装：

```dockerfile
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS production
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 8000
CMD ["node", "dist/main.js"]
```

- [ ] **Step 6: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add backend_nest/package.json backend_nest/package-lock.json \
        backend_nest/src/queue/export.service.ts \
        backend_nest/src/queue/render.processor.ts \
        backend_nest/src/queue/queue.module.ts \
        backend_nest/Dockerfile
git commit -m "feat: 实现完整FFmpeg视频导出合成(替代模拟进度,对齐Python export_service)"
```

---

## Task 7: 修复 C9 + C16 + C18 — 渲染任务节点透传 + 节点配置读取 + 取消语义

**问题：**
- **C9** Python 按 subtype（image_output/audio_output/upscale）透传上游资产，NestJS 统一生成模拟 PNG
- **C16** Python 根据 node_id 从 DB 读取 `WorkflowNode.config.params`，NestJS 强依赖调用方传入
- **C18** Python `revoke(terminate=True)` 终止运行中任务，NestJS `discard()` 不终止

**Files:**
- Modify: `backend_nest/src/queue/render.processor.ts`
- Modify: `backend_nest/src/queue/queue.service.ts`
- Modify: `backend_nest/src/modules/workflows/entities/workflow-node.entity.ts` (添加 node_id 类型校验)

**Interfaces:**
- Consumes: `WorkflowNode` 实体、`Job` (BullMQ，含 `isDiscarded()` 方法)
- Produces: `executeRenderTask` 支持 subtype 透传；`process` 入口读取节点配置；任务取消通过 `isDiscarded()` 主动退出

**参考：** Python `backend/app/tasks/render_tasks.py:82-124, 439-506`

- [ ] **Step 1: 修复 C16 — 入口读取 WorkflowNode.config.params**

修改 `backend_nest/src/queue/render.processor.ts`：

添加 import：
```typescript
import { WorkflowNode } from '../modules/workflows/entities/workflow-node.entity';
```

在 constructor 添加 WorkflowNode 仓库注入：
```typescript
  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    @InjectRepository(WorkflowNode) private nodeRepo: Repository<WorkflowNode>,
    private aiService: AiService,
    private minioService: MinioService,
    private exportService: ExportService,
  ) {
    super();
  }
```

修改 `queue.module.ts` 添加 `WorkflowNode` 到 `forFeature`：
```typescript
import { WorkflowNode } from '../modules/workflows/entities/workflow-node.entity';
// ...
TypeOrmModule.forFeature([RenderTask, MediaAsset, WorkflowNode]),
```

修改 `process` 方法，添加节点配置读取逻辑：

```typescript
  async process(job: Job<{ taskId: string; params: any }>) {
    const { taskId } = job.data;
    let params = job.data.params || {};

    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`任务不存在: ${taskId}`);
      return;
    }

    try {
      task.status = 'running';
      task.progress = 0;
      await this.taskRepo.save(task);

      // C16: params 为空但 task.nodeId 存在时，从 WorkflowNode.config.params 读取
      // （对齐 Python render_tasks.py:100-124）
      if ((!params.nodeParams || Object.keys(params.nodeParams || {}).length === 0) && task.nodeId) {
        const node = await this.nodeRepo.findOne({ where: { id: task.nodeId } });
        if (node?.config?.params) {
          params = { ...params, nodeParams: node.config.params };
          this.logger.log(`从节点 ${task.nodeId} 读取 params: ${JSON.stringify(Object.keys(params.nodeParams))}`);
        }
      }

      if (task.taskType.startsWith('ai_')) {
        await this.executeAiTask(task, job, params);
      } else if (task.taskType === 'export') {
        await this.executeExportTask(task, job, params);
      } else {
        await this.executeRenderTask(task, job, params);
      }

      // C18: 检查任务是否被取消（discard）
      const freshJob = await job.queue.getJob(job.id);
      if (freshJob && (await freshJob.isDiscarded())) {
        task.status = 'cancelled';
        await this.taskRepo.save(task);
        this.logger.log(`任务已取消: ${taskId}`);
        return;
      }

      task.status = 'completed';
      task.progress = 100;
      await this.taskRepo.save(task);

      this.logger.log(`任务完成: ${taskId} type=${task.taskType}`);
    } catch (err) {
      this.logger.error(`任务失败: ${taskId} err=${(err as Error).message}`);
      task.status = 'failed';
      task.errorMessage = (err as Error).message || '任务执行失败';
      await this.taskRepo.save(task);
      throw err;
    }
  }
```

- [ ] **Step 2: 修复 C9 — executeRenderTask 按 subtype 透传**

替换 `executeRenderTask` 方法：

```typescript
  // ── 模拟渲染任务（C9: 按 subtype 透传上游资产）──
  private async executeRenderTask(task: RenderTask, job: Job, params: any) {
    const nodeParams = params?.nodeParams || {};
    const inputArtifacts = params?.inputArtifacts || [];

    // 查询节点 subtype（用于透传逻辑）
    let subtype: string | undefined;
    if (task.nodeId) {
      const node = await this.nodeRepo.findOne({ where: { id: task.nodeId } });
      subtype = node?.config?.subtype;
    }

    const subtypeExtMap: Record<string, string> = {
      image_output: '.png',
      video_output: '.mp4',
      audio_output: '.mp3',
      upscale: '.png',
      remove_bg: '.png',
      style_transfer: '.png',
      extend_image: '.png',
    };
    const ext = subtypeExtMap[subtype || ''] || '.mp4';

    // image_output / upscale 节点：透传上游图片 URL
    if (['image_output', 'upscale'].includes(subtype || '') && inputArtifacts.length > 0) {
      const imageArt = inputArtifacts.find((a: any) => a.type === 'image' && a.url);
      if (imageArt) {
        await job.updateProgress(50);
        task.resultUrl = imageArt.url;
        await this.taskRepo.save(task);
        await job.updateProgress(100);
        return;
      }
    }

    // audio_output 节点：透传上游音频 URL
    if (subtype === 'audio_output' && inputArtifacts.length > 0) {
      const audioArt = inputArtifacts.find((a: any) => a.type === 'audio' && a.url);
      if (audioArt) {
        await job.updateProgress(50);
        task.resultUrl = audioArt.url;
        await this.taskRepo.save(task);
        await job.updateProgress(100);
        return;
      }
    }

    // 其他节点：模拟渲染进度
    for (let i = 0; i <= 100; i += 20) {
      // C18: 每次循环检查是否被取消
      const freshJob = await job.queue.getJob(job.id);
      if (freshJob && (await freshJob.isDiscarded())) {
        task.status = 'cancelled';
        await this.taskRepo.save(task);
        return;
      }
      task.progress = i;
      await this.taskRepo.save(task);
      await job.updateProgress(i);
      await new Promise(r => setTimeout(r, 500));
    }
    const resultUrl = await this.generateSimulatedResult(task.ownerId, ext.replace('.', ''));
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }
```

- [ ] **Step 3: 修复 C18 — executeAiTask 添加取消检查**

在 `executeAiTask` 方法的每个进度更新点之间添加取消检查。简化方案：在方法开头和结尾检查：

```typescript
  private async executeAiTask(
    task: RenderTask,
    job: Job,
    params: { modelId?: string; prompt?: string; inputArtifacts?: any[]; nodeParams?: any },
  ) {
    // C18: 检查取消
    await this.checkCancelled(job, task);

    const userId = task.ownerId;
    // ...（原有逻辑）

    // 在 AI 调用前再次检查
    await this.checkCancelled(job, task);

    // ...（AI 调用）

    await job.updateProgress(100);
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }

  /** C18: 检查任务是否被取消，若是则抛出异常终止执行 */
  private async checkCancelled(job: Job, task: RenderTask): Promise<void> {
    const freshJob = await job.queue.getJob(job.id);
    if (freshJob && (await freshJob.isDiscarded())) {
      task.status = 'cancelled';
      await this.taskRepo.save(task);
      throw new Error('任务已被取消');
    }
  }
```

- [ ] **Step 4: 修复 C18 — QueueService.cancelTask 保留 discard 行为**

`backend_nest/src/queue/queue.service.ts` 已使用 `job.discard()`，保持不变。但需添加注释说明：

```typescript
  async cancelTask(jobId: string): Promise<void> {
    // C18: discard() 防止重试，processor 内通过 isDiscarded() 主动退出
    // （对齐 Python revoke(terminate=True) 的"终止运行中任务"语义）
    const job = await this.renderQueue.getJob(jobId);
    if (job) {
      await job.discard();
      await job.remove();
    }
  }
```

- [ ] **Step 5: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add backend_nest/src/queue/render.processor.ts \
        backend_nest/src/queue/queue.service.ts \
        backend_nest/src/queue/queue.module.ts
git commit -m "fix: 修复渲染任务3项问题(节点透传/读取节点配置/取消语义主动退出)"
```

---

## Task 8: 修复 C10 + C11 + C12 — AI TTS/图生图/视频生成 API 兼容

**问题：**
- **C10** Python `call_audio_gen` 用 Ark 异步任务 API + MinIO 持久化，NestJS 用 OpenAI 同步 API + base64 返回
- **C11** Python 有 `call_img2img`，NestJS 无
- **C12** Python 视频生成 image 在 content 数组中，NestJS image 在顶层字段

**Files:**
- Modify: `backend_nest/src/modules/ai/ai.service.ts`

**Interfaces:**
- Consumes: `MinioService`、`MediaAsset` 仓库（需注入到 AiService）
- Produces: `callImageGen` 返回 `{url, revised_prompt}`；`callImg2Img` 新增；`callVideoGen`/`callAudioGen` 改用 Ark 异步 + MinIO 持久化

**参考：** Python `backend/app/services/ai_service.py:169-535`

- [ ] **Step 1: 修改 AiService 注入 MinioService + MediaAsset 仓库**

修改 `backend_nest/src/modules/ai/ai.service.ts` 的 constructor：

```typescript
import { MediaAsset } from '../media/entities/media-asset.entity';
import { MinioService } from '../../common/utils/minio.service';

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(AiProvider) private providerRepo: Repository<AiProvider>,
    @InjectRepository(AiModel) private modelRepo: Repository<AiModel>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private minioService: MinioService,
    private config: ConfigService,
  ) {}
```

修改 `backend_nest/src/modules/ai/ai.module.ts` 添加 MediaAsset + MinioService：

```typescript
import { MediaAsset } from '../media/entities/media-asset.entity';
import { AuthModule } from '../../common/auth/auth.module';  // 提供 MinioService

@Module({
  imports: [TypeOrmModule.forFeature([AiProvider, AiModel, MediaAsset]), AuthModule],
  // ...
})
```

- [ ] **Step 2: 修复 C11 + C12 — 重写 callImageGen + 新增 callImg2Img**

替换 `ai.service.ts` 中的 `callImageGen` 方法，并添加 `callImg2Img` + 辅助方法：

```typescript
  // ── AI API 调用（对齐 Python ai_service.py:169-535）──

  /** 文生图：返回 { url, revised_prompt }，url 已转存 MinIO */
  async callImageGen(modelId: string, params: any, userId: string): Promise<{ url: string; revised_prompt?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'image_gen');
    const size = this.normalizeImageSize(params?.size);

    const body: any = {
      model: model.modelId,
      prompt: params.prompt,
      size,
      n: params.n || 1,
    };

    try {
      const resp = await axios.post(
        `${provider.baseUrl.replace(/\/$/, '')}/images/generations`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 },
      );
      return await this.handleImageResponse(resp.data, userId);
    } catch (err) {
      this.logger.error(`文生图失败: ${(err as Error).message}`);
      throw new Error(`图片 API 调用失败: ${(err as Error).message}`);
    }
  }

  /** C11: 图生图（对齐 Python call_img2img）*/
  async callImg2Img(modelId: string, prompt: string, imageUrl: string, params: any, userId: string): Promise<{ url: string; revised_prompt?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'image_gen');
    const apiImage = await this.resolveImageUrl(imageUrl);
    const size = this.normalizeImageSize(params?.size);

    const body: any = {
      model: model.modelId,
      prompt,
      image: apiImage,
      size,
      n: params.n || 1,
    };

    try {
      const resp = await axios.post(
        `${provider.baseUrl.replace(/\/$/, '')}/images/generations`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 },
      );
      return await this.handleImageResponse(resp.data, userId);
    } catch (err) {
      this.logger.error(`图生图失败: ${(err as Error).message}`);
      throw new Error(`图片 API 调用失败: ${(err as Error).message}`);
    }
  }

  /** C12: 视频生成（对齐 Python _call_ark_async，image 在 content 数组中）*/
  async callVideoGen(modelId: string, params: any, userId: string): Promise<{ video_url: string; remote_task_id?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'video_gen');
    const baseUrl = provider.baseUrl.replace(/\/$/, '');

    // C12: content 数组格式（对齐 Python ai_service.py:456-460）
    const content: any[] = [{ type: 'text', text: params.prompt }];
    if (params.image) {
      const resolvedUrl = await this.resolveImageUrl(params.image);
      content.push({ type: 'image_url', image_url: { url: resolvedUrl } });
    }

    const body = { model: model.modelId, content };

    try {
      // 1. 提交异步任务
      const submitResp = await axios.post(
        `${baseUrl}/contents/generations/tasks`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      const remoteTaskId = submitResp.data.id;
      if (!remoteTaskId) throw new Error(`视频生成 API 未返回任务 ID`);

      // 2. 轮询
      const resultData = await this.pollArkTask(baseUrl, provider.apiKey, remoteTaskId);

      // 3. 提取 video_url
      const videoUrl = this.extractArkMediaUrl(resultData, 'video');

      // 4. 下载转存 MinIO
      const persistentUrl = await this.downloadToMinio(videoUrl, userId, `${remoteTaskId}.mp4`, 'video/mp4');
      return { video_url: persistentUrl, remote_task_id: remoteTaskId };
    } catch (err) {
      this.logger.error(`视频生成失败: ${(err as Error).message}`);
      throw new Error(`AI 服务暂时不可用，请稍后重试`);
    }
  }

  /** C10: TTS（对齐 Python call_audio_gen，改用 Ark 异步任务 + MinIO 持久化）*/
  async callAudioGen(modelId: string, params: any, userId: string): Promise<{ audio_url: string; remote_task_id?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'tts');
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const text = params.text || params.prompt || '';

    const body = {
      model: model.modelId,
      content: [{ type: 'text', text }],
    };

    try {
      const submitResp = await axios.post(
        `${baseUrl}/contents/generations/tasks`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      const remoteTaskId = submitResp.data.id;
      if (!remoteTaskId) throw new Error(`TTS API 未返回任务 ID`);

      const resultData = await this.pollArkTask(baseUrl, provider.apiKey, remoteTaskId);
      const audioUrl = this.extractArkMediaUrl(resultData, 'audio');
      const persistentUrl = await this.downloadToMinio(audioUrl, userId, `${remoteTaskId}.mp3`, 'audio/mpeg');
      return { audio_url: persistentUrl, remote_task_id: remoteTaskId };
    } catch (err) {
      this.logger.error(`TTS 失败: ${(err as Error).message}`);
      throw new Error(`AI 服务暂时不可用，请稍后重试`);
    }
  }

  /** LLM 调用（添加 temperature 参数）*/
  async callLlm(modelId: string, messages: any[], userId: string, temperature = 0.7): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'llm');
    try {
      const resp = await axios.post(
        `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`,
        { model: model.modelId, messages, temperature },
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      return resp.data.choices[0].message.content;
    } catch (err) {
      this.logger.error(`LLM 调用失败: ${(err as Error).message}`);
      throw new Error(`AI 服务暂时不可用，请稍后重试`);
    }
  }

  // ── 辅助方法（对齐 Python ai_service.py:104-414）──

  /** 处理图片 API 响应：转存 MinIO + 创建 MediaAsset */
  private async handleImageResponse(data: any, userId: string): Promise<{ url: string; revised_prompt?: string }> {
    if (!data?.data?.length) throw new Error(`图片生成 API 返回格式异常`);
    const imageData = data.data[0];
    const remoteUrl = imageData.url || '';
    const revisedPrompt = imageData.revised_prompt || '';

    if (!remoteUrl) return { url: '', revised_prompt: revisedPrompt };

    try {
      const persistentUrl = await this.downloadToMinio(remoteUrl, userId, `${uuidv4()}.png`, 'image/png');
      return { url: persistentUrl, revised_prompt: revisedPrompt };
    } catch (err) {
      this.logger.warn(`MinIO 持久化失败，使用原始 URL: ${(err as Error).message}`);
      return { url: remoteUrl, revised_prompt: revisedPrompt };
    }
  }

  /** 解析图片 URL：内部 /api/v1/media/{id}/download 路径转 base64，外部 URL 原样返回 */
  private async resolveImageUrl(imageUrl: string): Promise<string> {
    if (!imageUrl.startsWith('/api/v1/media/')) return imageUrl;

    try {
      const parts = imageUrl.replace(/^\//, '').split('/');
      const mediaId = parts[3] || parts[parts.length - 1].split('?')[0];
      const asset = await this.mediaRepo.findOne({ where: { id: mediaId } });
      if (!asset) return imageUrl;

      const presignedUrl = await this.minioService.getPresignedUrl(asset.storageKey, 1);
      const resp = await axios.get(presignedUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const b64 = Buffer.from(resp.data).toString('base64');
      const mime = asset.fileType || 'image/png';
      return `data:${mime};base64,${b64}`;
    } catch (err) {
      this.logger.warn(`图片转换失败: ${(err as Error).message}`);
      return imageUrl;
    }
  }

  /** 下载外部 URL 到 MinIO + 创建 MediaAsset，返回 /api/v1/media/{id}/download */
  private async downloadToMinio(url: string, userId: string, filename: string, contentType: string): Promise<string> {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxRedirects: 5 } as any);
    const buffer = Buffer.from(resp.data);
    const storageKey = `ai_gen/${userId}/${uuidv4()}/${filename}`;

    await this.minioService.uploadFile(storageKey, buffer, contentType);

    const mediaAsset = this.mediaRepo.create({
      id: uuidv4(),
      ownerId: userId,
      projectId: undefined,
      fileName: filename,
      fileType: contentType,
      fileSize: buffer.length,
      storageKey,
    });
    await this.mediaRepo.save(mediaAsset);
    return `/api/v1/media/${mediaAsset.id}/download`;
  }

  /** 轮询 Ark 异步任务直到完成 */
  private async pollArkTask(baseUrl: string, apiKey: string, taskId: string, timeout = 300000, interval = 5000): Promise<any> {
    const url = `${baseUrl}/contents/generations/tasks/${taskId}`;
    const headers = { Authorization: `Bearer ${apiKey}` };
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const resp = await axios.get(url, { headers, timeout: 30000 });
      const data = resp.data;
      const status = data.status || '';

      if (status === 'succeeded') return data;
      if (['failed', 'expired', 'cancelled'].includes(status)) {
        throw new Error(`任务 ${taskId} 状态异常: ${status}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`任务 ${taskId} 轮询超时(${timeout / 1000}s)`);
  }

  /** 从 Ark 异步任务结果提取媒体 URL（对齐 Python _extract_ark_media_url）*/
  private extractArkMediaUrl(resultData: any, mediaType: 'video' | 'audio'): string {
    const urlField = `${mediaType}_url`;
    let mediaUrl: string | undefined;

    // 格式1：content.{media_type}_url
    const content = resultData.content;
    if (content && typeof content === 'object') {
      mediaUrl = content[urlField];
    }

    // 格式2：choices[].message.content
    if (!mediaUrl && Array.isArray(resultData.choices)) {
      for (const choice of resultData.choices) {
        const msgContent = choice.message?.content;
        if (typeof msgContent === 'string' && msgContent.startsWith('http')) {
          mediaUrl = msgContent;
          break;
        }
        if (Array.isArray(msgContent)) {
          for (const item of msgContent) {
            if (item?.type === urlField) {
              mediaUrl = item[urlField]?.url;
            } else if (item?.type === 'file_url') {
              mediaUrl = item.file_url?.url;
            }
            if (mediaUrl) break;
          }
        }
        if (mediaUrl) break;
      }
    }

    // 格式3：data[].url
    if (!mediaUrl && Array.isArray(resultData.data) && resultData.data.length > 0) {
      mediaUrl = resultData.data[0].url || resultData.data[0][urlField];
    }

    if (!mediaUrl) {
      throw new Error(`${mediaType}生成任务成功但未找到 ${mediaType} URL`);
    }
    return mediaUrl;
  }

  /** 规范化图片 size 参数（对齐 Python _call_image_api:190-195）*/
  private normalizeImageSize(size?: string): string {
    const rawSize = size || '2k';
    const validSizes = new Set([
      '1k', '2k', '4k',
      '512x512', '768x768', '1024x1024', '1280x720', '720x1280',
      '1536x1536', '2048x2048', '1024x1536', '1536x1024',
    ]);
    return validSizes.has(String(rawSize)) ? String(rawSize) : '2k';
  }
```

- [ ] **Step 3: 修改 RenderProcessor 适配新 AI API 签名**

修改 `backend_nest/src/queue/render.processor.ts` 的 `executeAiTask`：

```typescript
  private async executeAiTask(
    task: RenderTask,
    job: Job,
    params: { modelId?: string; prompt?: string; inputArtifacts?: any[]; nodeParams?: any },
  ) {
    await this.checkCancelled(job, task);

    const userId = task.ownerId;
    const nodeParams = params.nodeParams || {};
    const prompt = params.prompt || nodeParams.prompt || nodeParams.text || '';
    const modelId = params.modelId || nodeParams.model_id;
    const inputArtifacts = params.inputArtifacts || [];

    if (!modelId) {
      throw new Error('AI 任务缺少 model_id');
    }

    await job.updateProgress(10);

    let resultUrl: string;

    if (task.taskType === 'ai_text2img') {
      const result = await this.aiService.callImageGen(modelId, { prompt, size: nodeParams.size }, userId);
      await job.updateProgress(60);
      resultUrl = result.url;
    } else if (task.taskType === 'ai_img2img') {
      // C11: 图生图
      const imageUrl = inputArtifacts.find((a: any) => a.url)?.url || '';
      if (!imageUrl) {
        this.logger.warn(`图生图任务 ${task.id} 无上游图片，使用模拟`);
        resultUrl = await this.generateSimulatedResult(userId, 'png');
      } else {
        const result = await this.aiService.callImg2Img(modelId, prompt, imageUrl, { size: nodeParams.size }, userId);
        await job.updateProgress(60);
        resultUrl = result.url;
      }
    } else if (task.taskType === 'ai_text2video' || task.taskType === 'ai_img2video') {
      if (task.taskType === 'ai_img2video' && inputArtifacts.length === 0) {
        this.logger.warn(`图生视频任务 ${task.id} 无上游图片，使用模拟`);
        resultUrl = await this.generateSimulatedResult(userId, 'mp4');
      } else {
        const videoParams: any = { prompt };
        if (inputArtifacts.length > 0) {
          videoParams.image = inputArtifacts.find((a: any) => a.url)?.url;
        }
        const result = await this.aiService.callVideoGen(modelId, videoParams, userId);
        await job.updateProgress(60);
        resultUrl = result.video_url;
      }
    } else if (task.taskType === 'ai_tts') {
      // C10: TTS 改用 Ark 异步
      const result = await this.aiService.callAudioGen(modelId, { text: prompt, voice: nodeParams.voice }, userId);
      await job.updateProgress(60);
      resultUrl = result.audio_url;
    } else {
      // LLM 文本生成
      const content = await this.aiService.callLlm(modelId, [{ role: 'user', content: prompt }], userId);
      await job.updateProgress(60);
      const buffer = Buffer.from(content, 'utf-8');
      resultUrl = await this.uploadResultAndBuildUrl(buffer, userId, 'txt', 'text/plain');
    }

    await this.checkCancelled(job, task);
    await job.updateProgress(100);
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }
```

- [ ] **Step 4: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add backend_nest/src/modules/ai/ai.service.ts \
        backend_nest/src/modules/ai/ai.module.ts \
        backend_nest/src/queue/render.processor.ts
git commit -m "fix: 修复AI服务3项问题(TTS改Ark异步/新增图生图/视频生成image入content数组)"
```

---

## Task 9: 修复 C13 — AI 工作流生成完整移植

**问题：** Python `generate_workflow` 有完整 SYSTEM_PROMPT、节点白名单校验、Kahn 拓扑布局、参数预填。NestJS `ai.service.ts:283-303` 为极简 stub。

**Files:**
- Modify: `backend_nest/src/modules/ai/ai.service.ts`
- Modify: `backend_nest/src/modules/ai/dto/ai.dto.ts` (添加 duration 字段)

**Interfaces:**
- Consumes: `callLlm`、`MediaAsset` 仓库
- Produces: `generateWorkflow` 返回 `{ nodes: [...], edges: [...] }`，节点含 id/node_type/label/position_x/position_y/config

**参考：** Python `backend/app/services/ai_service.py:545-916`

- [ ] **Step 1: 添加 generateWorkflow 完整实现**

在 `backend_nest/src/modules/ai/ai.service.ts` 中替换 `generateWorkflow` 方法，并添加常量和辅助方法：

```typescript
// ── AI 工作流生成常量（对齐 Python ai_service.py:545-645）──

const NODE_WHITELIST: Record<string, string> = {
  text_input: 'input',
  image_input: 'input',
  audio_input: 'input',
  text_to_image: 'ai_inference',
  image_to_image: 'ai_inference',
  image_to_video: 'ai_inference',
  text_to_speech: 'ai_inference',
  text_to_video: 'ai_inference',
  text_to_subtitle: 'ai_inference',
  upscale: 'processing',
  style_transfer: 'processing',
  remove_bg: 'processing',
  extend_image: 'processing',
  if_else: 'control',
  loop: 'control',
  merge: 'control',
  video_output: 'output',
  image_output: 'output',
  audio_output: 'output',
};

const NODE_DEFAULT_LABELS: Record<string, string> = {
  text_input: '文本输入',
  image_input: '图片输入',
  audio_input: '音频输入',
  text_to_image: '文生图',
  image_to_image: '图生图',
  image_to_video: '图生视频',
  text_to_speech: '文生语音',
  text_to_video: '文生视频',
  text_to_subtitle: 'AI 字幕',
  upscale: '高清放大',
  style_transfer: '风格化',
  remove_bg: '抠图',
  extend_image: '扩图',
  if_else: '条件分支',
  loop: '循环',
  merge: '合并',
  video_output: '视频输出',
  image_output: '图片输出',
  audio_output: '音频输出',
};

const NODE_DEFAULT_PARAMS: Record<string, any> = {
  text_input: { text: '' },
  image_input: { url: '' },
  audio_input: { url: '' },
  text_to_image: { prompt: '', size: '1024x1024' },
  image_to_image: { prompt: '', size: '1024x1024' },
  image_to_video: { prompt: '', duration: 5 },
  text_to_speech: { text: '', voice: 'default' },
  text_to_video: { prompt: '', duration: 5 },
  text_to_subtitle: { prompt: '', duration: 30 },
  upscale: { scale: 2 },
  style_transfer: { style: '' },
  remove_bg: {},
  extend_image: { direction: 'all' },
  if_else: { condition: '' },
  loop: { count: 1 },
  merge: {},
  video_output: { format: 'mp4' },
  image_output: { format: 'png' },
  audio_output: { format: 'mp3' },
};

const AI_INFERENCE_MODEL_TYPE: Record<string, string> = {
  text_to_image: 'image_gen',
  image_to_image: 'image_gen',
  image_to_video: 'video_gen',
  text_to_speech: 'tts',
  text_to_video: 'video_gen',
  text_to_subtitle: 'llm',
};

const SYSTEM_PROMPT = `你是 AI 视频工作流编排助手。根据用户描述生成工作流节点和连接。

合法节点类型(仅可使用以下 subtype):
- 输入:text_input(文本输入), image_input(图片输入), audio_input(音频输入)
- AI 推理:text_to_image(文生图), image_to_image(图生图), image_to_video(图生视频), text_to_speech(文生语音), text_to_video(文生视频)
- 处理:upscale(高清放大), style_transfer(风格化), remove_bg(抠图), extend_image(扩图)
- 控制:if_else(条件分支), loop(循环), merge(合并)
- 输出:video_output(视频输出), image_output(图片输出), audio_output(音频输出)

输出严格 JSON 格式(不要 markdown 代码块,不要额外文字):
{"nodes":[{"id":"n1","subtype":"text_input","label":"文本输入"}],"edges":[{"from":"n1","to":"n2"}]}

规则:
1. 节点 id 用简单标识(n1, n2, n3...)
2. 连接需符合数据流方向:输入 → AI推理/处理 → 输出
3. label 用中文
4. 不要填 params(由系统自动填充)
`;
```

替换 `generateWorkflow` 方法（在 AiService 类内）：

```typescript
  // ── AI 生成工作流（对齐 Python ai_service.py:801-916）──
  async generateWorkflow(userId: string, dto: GenerateWorkflowDto) {
    // 1. 获取 LLM 模型（dto.model_id 或默认 LLM）
    const llmModelId = await this.getDefaultLlmModelId(userId, dto.model_id);

    // 2. 调 LLM
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: dto.description },
    ];
    this.logger.log(`[AI:Generate] 调用 LLM 生成工作流, description=${dto.description.slice(0, 50)}`);
    const rawResponse = await this.callLlm(llmModelId, messages, userId, 0.3);

    // 3. 解析 JSON
    const data = this.parseLlmJson(rawResponse);

    // 4. 校验 subtype 白名单 + 生成新 ID
    const validNodes: any[] = [];
    const origToNew: Record<string, string> = {};
    let skipped = 0;

    for (const n of data.nodes) {
      const origId = n.id || `n${validNodes.length + 1}`;
      const subtype = n.subtype || '';
      if (!NODE_WHITELIST[subtype]) {
        this.logger.warn(`[AI:Generate] 跳过非法 subtype: id=${origId}, subtype=${subtype}`);
        skipped++;
        continue;
      }
      const newId = this.generateNodeId();
      validNodes.push({
        orig_id: origId,
        subtype,
        label: n.label || NODE_DEFAULT_LABELS[subtype] || subtype,
        new_id: newId,
      });
      origToNew[origId] = newId;
    }

    if (validNodes.length === 0) {
      throw new ConflictException('AI 生成内容无效:全部节点 subtype 非法');
    }

    // 5. 过滤 edges + 重映射 id
    const validEdges: any[] = [];
    for (const e of data.edges) {
      const src = e.from || '';
      const tgt = e.to || '';
      if (origToNew[src] && origToNew[tgt]) {
        validEdges.push({ from: src, to: tgt });
      }
    }

    // 6. 计算布局（Kahn 拓扑分层）
    this.computeLayout(validNodes, validEdges);

    // 7. 预填参数 + 组装最终节点
    const resultNodes = [];
    for (const n of validNodes) {
      const nodeType = NODE_WHITELIST[n.subtype];
      const params = { ...NODE_DEFAULT_PARAMS[n.subtype] };

      // 预填: text_input.params.text = description
      if (n.subtype === 'text_input') {
        params.text = dto.description;
      }
      // 预填: AI 推理节点 params.prompt = description + model_id
      else if (['text_to_image', 'image_to_image', 'image_to_video', 'text_to_speech'].includes(n.subtype)) {
        params.prompt = dto.description;
        const modelType = AI_INFERENCE_MODEL_TYPE[n.subtype];
        if (modelType) {
          const defaultModel = await this.getDefaultModelForType(userId, modelType);
          if (defaultModel) {
            params.model_id = defaultModel;
          }
        }
      }

      resultNodes.push({
        id: n.new_id,
        node_type: nodeType,
        label: n.label,
        position_x: n.position_x,
        position_y: n.position_y,
        config: {
          type: nodeType,
          subtype: n.subtype,
          label: n.label,
          params,
          status: 'idle',
          progress: 0,
          outputArtifacts: [],
        },
      });
    }

    // 8. 组装最终边
    const resultEdges = validEdges.map(e => ({
      id: this.generateEdgeId(),
      source_node_id: origToNew[e.from],
      target_node_id: origToNew[e.to],
      source_port: null,
      target_port: null,
    }));

    this.logger.log(`[AI:Generate] 生成完成: ${resultNodes.length} 节点, ${resultEdges.length} 边, 跳过 ${skipped} 非法`);
    return { nodes: resultNodes, edges: resultEdges };
  }

  /** 获取默认 LLM 模型 ID（对齐 Python _get_default_llm_model_id）*/
  private async getDefaultLlmModelId(userId: string, modelId?: string): Promise<string> {
    if (modelId) return modelId;

    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('model.model_type = :modelType', { modelType: 'llm' })
      .andWhere('model.is_active = true')
      .orderBy('model.created_at', 'ASC')
      .limit(1)
      .getOne();

    if (!model) {
      throw new NotFoundException('未找到可用的 LLM 模型,请先在设置页配置 model_type=llm 的 active 模型');
    }
    return model.id;
  }

  /** 查找指定 model_type 的首个 active 模型 ID（对齐 Python _get_default_model_for_type）*/
  private async getDefaultModelForType(userId: string, modelType: string): Promise<string | null> {
    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('model.model_type = :modelType', { modelType })
      .andWhere('model.is_active = true')
      .orderBy('model.created_at', 'ASC')
      .limit(1)
      .getOne();
    return model?.id || null;
  }

  /** 解析 LLM 返回的 JSON（容忍 markdown 代码块）*/
  private parseLlmJson(raw: string): any {
    let text = raw.trim();
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      text = lines[lines.length - 1].trim() === '```'
        ? lines.slice(1, -1).join('\n')
        : lines.slice(1).join('\n');
      text = text.trim();
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ConflictException(`AI 返回格式异常,无法解析为 JSON: ${(e as Error).message}`);
    }

    if (typeof data !== 'object' || data === null) {
      throw new ConflictException('AI 返回格式异常:顶层应为 JSON 对象');
    }
    if (!Array.isArray(data.nodes)) {
      throw new ConflictException('AI 返回格式异常:缺少 nodes 数组');
    }
    if (!Array.isArray(data.edges)) {
      throw new ConflictException('AI 返回格式异常:缺少 edges 数组');
    }
    return data;
  }

  /** 生成节点 ID: node-{timestamp_ms}-{rand6} */
  private generateNodeId(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `node-${ts}-${rand}`;
  }

  /** 生成边 ID: edge-{timestamp_ms}-{rand6} */
  private generateEdgeId(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `edge-${ts}-${rand}`;
  }

  /** Kahn 拓扑分层计算 position（对齐 Python _compute_layout）*/
  private computeLayout(validNodes: any[], edges: any[]): void {
    const idToIdx: Record<string, number> = {};
    validNodes.forEach((n, i) => { idToIdx[n.orig_id] = i; });

    // 入度 + 邻接表
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    validNodes.forEach(n => {
      inDegree[n.orig_id] = 0;
      adj[n.orig_id] = [];
    });

    for (const e of edges) {
      const src = e.from;
      const tgt = e.to;
      if (src in inDegree && tgt in inDegree) {
        adj[src].push(tgt);
        inDegree[tgt]++;
      }
    }

    // Kahn 分层
    const layer: Record<string, number> = {};
    validNodes.forEach(n => { layer[n.orig_id] = 0; });

    const queue: string[] = [];
    for (const id in inDegree) {
      if (inDegree[id] === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const nid = queue.shift()!;
      processed++;
      for (const child of adj[nid]) {
        layer[child] = Math.max(layer[child], layer[nid] + 1);
        inDegree[child]--;
        if (inDegree[child] === 0) queue.push(child);
      }
    }

    // 环检测
    if (processed < validNodes.length) {
      this.logger.warn('[AI:Generate] 检测到环,使用 fallback 布局');
      validNodes.forEach((n, i) => {
        n.position_x = i * 300;
        n.position_y = 0;
      });
      return;
    }

    // 按 layer 分组
    const byLayer: Record<number, any[]> = {};
    validNodes.forEach(n => {
      const l = layer[n.orig_id];
      if (!byLayer[l]) byLayer[l] = [];
      byLayer[l].push(n);
    });

    for (const layerNum in byLayer) {
      byLayer[layerNum].sort((a, b) => a.orig_id.localeCompare(b.orig_id));
      byLayer[layerNum].forEach((n, idx) => {
        n.position_x = Number(layerNum) * 300;
        n.position_y = idx * 150;
      });
    }
  }
```

- [ ] **Step 2: 修改 GenerateSubtitlesDto 添加 duration 字段**

修改 `backend_nest/src/modules/ai/dto/ai.dto.ts`：

```typescript
export class GenerateSubtitlesDto {
  @IsString() prompt: string;
  @IsOptional() duration?: number;
  @IsString() @IsOptional() model_id?: string;
}
```

修改 `ai.service.ts` 的 `generateSubtitles` 方法对齐 Python `ai.py:460-490`（使用专门的 SUBTITLE_SYSTEM_PROMPT）：

```typescript
  async generateSubtitles(userId: string, dto: GenerateSubtitlesDto) {
    const modelId = await this.getDefaultLlmModelId(userId, dto.model_id);
    const duration = dto.duration || 30;

    const subtitleSystemPrompt = `你是一个专业的字幕生成助手。根据用户提供的文本内容，生成带时间轴的字幕分段。

输出严格的 JSON 格式（不要 markdown 代码块，不要额外文字）：
{"segments":[{"start":0.0,"end":3.5,"text":"第一句字幕"},{"start":3.5,"end":7.0,"text":"第二句字幕"}]}

规则：
1. start/end 为秒数，从 0 开始
2. 每段字幕 2-5 秒，根据语义自然断句
3. 所有段时间总和应接近总时长 duration
4. 段与段时间连续，不重叠不间隔
5. text 使用中文
`;

    const messages = [
      { role: 'system', content: subtitleSystemPrompt },
      { role: 'user', content: `文本内容：${dto.prompt}\n总时长（秒）：${duration}` },
    ];

    const content = await this.callLlm(modelId, messages, userId, 0.3);

    // 解析 JSON（容忍 markdown 代码块）
    let text = content.trim();
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      text = lines[lines.length - 1].trim() === '```'
        ? lines.slice(1, -1).join('\n')
        : lines.slice(1).join('\n');
      text = text.trim();
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ConflictException(`AI 返回格式异常: ${(e as Error).message}`);
    }

    const segments = data.segments || [];
    if (segments.length === 0) {
      throw new ConflictException('AI 未生成字幕分段');
    }
    return { segments };
  }
```

- [ ] **Step 3: 验证 TS 编译通过**

Run: `cd backend_nest && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add backend_nest/src/modules/ai/ai.service.ts backend_nest/src/modules/ai/dto/ai.dto.ts
git commit -m "feat: 完整移植AI工作流生成(SYSTEM_PROMPT+白名单校验+Kahn拓扑布局+参数预填)"
```

---

## Task 10: 修复 C17 — 文档化 result_url 统一策略

**问题：** Python 直接用 AI 服务返回的临时 URL，NestJS 下载转存 MinIO 生成持久路径。

**决策：** NestJS 的转存 MinIO 策略更合理（临时 URL 24h 过期，持久路径长期可用）。Task 8 已统一所有 AI 服务（callImageGen/callImg2Img/callVideoGen/callAudioGen）返回 MinIO 持久路径。此 Task 仅文档化决策，无需改代码。

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-nestjs-python-comparison-report.md` (更新 C17 状态)

- [ ] **Step 1: 更新对比报告 C17 状态**

在 `docs/superpowers/specs/2026-07-15-nestjs-python-comparison-report.md` 的 C17 条目后追加：

```markdown
**状态：已解决（Task 8 已统一为 MinIO 转存策略，比 Python 临时 URL 更优）**
```

- [ ] **Step 2: 提交**

```bash
git add docs/superpowers/specs/2026-07-15-nestjs-python-comparison-report.md
git commit -m "docs: 更新对比报告C17状态(统一MinIO转存策略已实施)"
```

---

## Self-Review 检查清单

执行完所有 Task 后，运行以下检查：

- [ ] **1. TS 编译：** `cd backend_nest && npx tsc --noEmit` 无错误
- [ ] **2. 单元测试：** `cd backend_nest && npx jest` 13 个测试通过
- [ ] **3. Spec 覆盖：** 18 个 Critical 全部有对应 Task
  - C1 → Task 1 ✓
  - C2 → Task 2 ✓
  - C3 → Task 3 ✓
  - C4 → Task 4 ✓
  - C5 → Task 5 ✓
  - C6 → Task 4 ✓
  - C7 → Task 4 ✓
  - C8 → Task 6 ✓
  - C9 → Task 7 ✓
  - C10 → Task 8 ✓
  - C11 → Task 8 ✓
  - C12 → Task 8 ✓
  - C13 → Task 9 ✓
  - C14 → Task 3 ✓
  - C15 → Task 5 ✓
  - C16 → Task 7 ✓
  - C17 → Task 10（文档化）✓
  - C18 → Task 7 ✓
  - C19 → Task 2 ✓
  - I-33 → Task 2 ✓（额外修复）
- [ ] **4. 类型一致性：** `getProviderAndModel` 在 Task 5/8/9 中签名一致 `(modelId, userId, expectedType?)`
- [ ] **5. 占位符扫描：** 无 TBD/TODO/"实现后补充"
- [ ] **6. git log 检查：** 9 个 commit（Task 1-9 各一个，Task 10 文档化），消息均为简短中文

## 执行后验证

完成所有 Task 后，建议手动验证：
1. 启动 NestJS 服务 + PostgreSQL + Redis + MinIO
2. 注册/登录用户（验证 C1 修复）
3. 创建项目 + 工作流节点（验证 C3/C14）
4. 上传媒体 + 下载（验证 C6/C7）
5. AI 工作流生成（验证 C13）
6. 视频导出（验证 C8，需 ffmpeg 二进制）
7. WebSocket 协作（验证 C2/C19/I-33）
