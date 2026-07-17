# NestJS Important 问题修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 NestJS 后端与 Python 后端对比发现的 32 个 Important 问题（I-24/I-31 在 Critical 修复后已对齐，I-33 已修复），按优先级分 5 批执行。

**Architecture:** 逐批对齐 NestJS 实现到 Python 真相源。每批聚焦一个维度（状态码/env、DB Schema、API 路由、服务层、异步+WS），机械修改为主，含完整修改代码和验证步骤。

**Tech Stack:** NestJS 10.x, TypeORM 0.3.x (synchronize: false), BullMQ 5.x, Socket.IO, TypeScript

## Global Constraints

- Python 后端是 schema 和行为真相源，NestJS 必须对齐
- TypeORM `synchronize: false`：实体声明不影响 DB 实际约束，但需对齐 Python 模型声明（代码可读性 + TypeORM 查询行为）
- 所有 API 响应格式兼容 FastAPI：错误返回 `{ detail: string }`
- git commit 消息用简短中文
- 修改后必须通过 `npx tsc --noEmit`（0 错误）和 `npx jest`（现有 13 测试通过）
- 禁止添加不必要的防御性代码或过度工程化
- FastApiCompatFilter 已将 NestJS 异常转换为 `{ detail: string }` 格式

---

## Task 1: 状态码全局对齐 + env 配置（I-11/I-12/I-35）

**Files:**
- Modify: `backend_nest/src/modules/auth/auth.controller.ts`
- Modify: `backend_nest/src/modules/projects/projects.controller.ts`
- Modify: `backend_nest/src/modules/workflows/workflows.controller.ts`
- Modify: `backend_nest/src/modules/media/media.controller.ts`
- Modify: `backend_nest/src/modules/render/render.controller.ts`
- Modify: `backend_nest/src/modules/ai/ai.controller.ts`
- Modify: `backend_nest/src/modules/snapshots/snapshots.controller.ts`
- Modify: `backend_nest/src/modules/templates/templates.controller.ts`
- Modify: `backend_nest/src/modules/invitations/invitations.controller.ts`
- Modify: `backend_nest/src/common/config/configuration.ts`
- Modify: `backend_nest/.env.example`

**Interfaces:**
- Consumes: 无
- Produces: 所有 POST 返回 200，非 AI 的 DELETE 返回 204 无 body，CORS 支持 JSON 数组格式

**背景：**
- I-11: Python FastAPI 默认 POST 返回 200，NestJS 默认 201。需在所有 @Post 方法加 @HttpCode(200)
- I-12: Python projects/snapshots/workflows/media DELETE 返回 204 无 body；Python ai provider/model DELETE 返回 200+{message}。NestJS 统一返回 200+{detail}
- I-35: Python CORS_ORIGINS 是 JSON 数组格式，端口范围 5173-5183；NestJS 是逗号分隔，仅 5173

- [ ] **Step 1: 修改 auth.controller.ts — 所有 @Post 加 @HttpCode(200)**

在 import 中加入 `HttpCode`，为 register/login/refresh 三个 @Post 方法添加 `@HttpCode(200)` 装饰器：

```typescript
// backend_nest/src/modules/auth/auth.controller.ts
import {
  Controller, Get, Post, Put, Body, UseGuards, HttpCode,
} from '@nestjs/common';
// ...
  @Post('register')
  @HttpCode(200)
  register(...) { ... }

  @Post('login')
  @HttpCode(200)
  login(...) { ... }

  @Post('refresh')
  @HttpCode(200)
  refresh(...) { ... }
```

- [ ] **Step 2: 修改 projects.controller.ts — @Post 加 @HttpCode(200)，@Delete 改 204**

```typescript
// backend_nest/src/modules/projects/projects.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards,
  UseInterceptors, UploadedFile, Res, HttpCode,
} from '@nestjs/common';
// ...
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(200)
  create(...) { ... }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id') projectId: string) {
    await this.projectsService.delete(userId, projectId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cover')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  uploadCover(...) { ... }
```

注意：delete 方法移除 `return { detail: '已删除' };`，返回 void（204 无 body）。

- [ ] **Step 3: 修改 workflows.controller.ts — @Post 加 @HttpCode(200)，@Delete 改 204**

```typescript
// backend_nest/src/modules/workflows/workflows.controller.ts
import {
  Controller, Get, Post, Delete, Put, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
// ...
  @Post(':id/nodes')
  @HttpCode(200)
  createNode(...) { ... }

  @Delete(':id/nodes/:nodeId')
  @HttpCode(204)
  async deleteNode(...) {
    await this.workflowsService.deleteNode(projectId, userId, nodeId);
  }

  @Post(':id/edges')
  @HttpCode(200)
  createEdge(...) { ... }

  @Delete(':id/edges/:edgeId')
  @HttpCode(204)
  async deleteEdge(...) {
    await this.workflowsService.deleteEdge(projectId, userId, edgeId);
  }
```

注意：deleteNode/deleteEdge 移除 `return { detail: '已删除' };`。

- [ ] **Step 4: 修改 media.controller.ts — @Post 加 @HttpCode(200)，@Delete 改 204**

```typescript
// backend_nest/src/modules/media/media.controller.ts
// import 加入 HttpCode
  @Post('upload')
  @HttpCode(200)
  upload(...) { ... }

  @Delete(':id')
  @HttpCode(204)
  async delete(...) {
    await this.mediaService.delete(userId, id);
  }
```

注意：delete 方法移除返回 body。

- [ ] **Step 5: 修改 render.controller.ts — 所有 @Post 加 @HttpCode(200)**

render.controller.ts 有 4 个 @Post：create、cancel、retry、export。全部加 @HttpCode(200)。render 无 @Delete。

- [ ] **Step 6: 修改 ai.controller.ts — @Post 加 @HttpCode(200)，@Delete 保持 200+body**

```typescript
// backend_nest/src/modules/ai/ai.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode,
} from '@nestjs/common';
// ...
  @Post('providers')
  @HttpCode(200)
  createProvider(...) { ... }

  // DELETE providers 保持 200+body（Python ai.py:168 返回 {message: ...}）
  @Delete('providers/:id')
  async deleteProvider(...) {
    return await this.aiService.deleteProvider(userId, id);
  }

  @Post('models')
  @HttpCode(200)
  createModel(...) { ... }

  // DELETE models 保持 200+body（Python ai.py:295 返回 {message: ...}）
  @Delete('models/:id')
  async deleteModel(...) {
    await this.aiService.deleteModel(userId, id);
    return { message: '已删除模型' };  // 对齐 Python 的 message 字段名
  }

  @Post('generate-workflow')
  @HttpCode(200)
  generateWorkflow(...) { ... }

  @Post('generate-subtitles')
  @HttpCode(200)
  generateSubtitles(...) { ... }
```

注意：deleteModel 的返回从 `{ detail: '已删除' }` 改为 `{ message: '已删除模型' }`（对齐 Python ai.py:295）。

- [ ] **Step 7: 修改 snapshots.controller.ts — @Post 加 @HttpCode(200)，@Delete 改 204**

```typescript
// snapshots.controller.ts
  @Post('projects/:id/snapshots')
  @HttpCode(200)
  create(...) { ... }

  @Delete('snapshots/:id')
  @HttpCode(204)
  async delete(...) {
    await this.snapshotsService.delete(userId, id);
  }

  @Post('snapshots/:id/restore')
  @HttpCode(200)
  restore(...) { ... }
```

注意：delete 方法移除返回 body（Python snapshots.py:192-202 是 status_code=204 无 body）。

- [ ] **Step 8: 修改 templates.controller.ts — @Post 加 @HttpCode(200)**

templates.controller.ts 有 @Post('templates/:id/clone') 和 @Post('projects/:id/publish')，加 @HttpCode(200)。@Delete('templates/:id') 已有 @HttpCode(204)，无需修改。

- [ ] **Step 9: 修改 invitations.controller.ts — @Post 加 @HttpCode(200)，@Delete 改 204**

```typescript
// invitations.controller.ts
  @Post('projects/:id/invitations')
  @HttpCode(200)
  createInvitation(...) { ... }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  acceptInvitation(...) { ... }

  @Delete('projects/:id/collaborators/:userId')
  @HttpCode(204)
  async removeCollaborator(...) {
    await this.invitationsService.removeCollaborator(userId, id, targetUserId);
  }
```

注意：removeCollaborator 移除返回 body。

- [ ] **Step 10: 修改 configuration.ts — CORS_ORIGINS 支持 JSON 数组 + 端口范围 5173-5183（I-35）**

```typescript
// backend_nest/src/common/config/configuration.ts
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
  // ... 其他配置不变
  cors: {
    origins: parseCorsOrigins(),
  },
  // ...
});
```

- [ ] **Step 11: 修改 .env.example — CORS_ORIGINS 格式对齐 Python**

```env
# CORS_ORIGINS 支持 JSON 数组或逗号分隔格式，默认 5173-5183
CORS_ORIGINS=["http://localhost:5173"]
```

- [ ] **Step 12: 类型检查 + 测试**

Run: `cd backend_nest && npx tsc --noEmit && npx jest`
Expected: 0 tsc 错误，13/13 jest 通过

- [ ] **Step 13: Commit**

```bash
git add backend_nest/src/modules/*/controllers/*.controller.ts backend_nest/src/common/config/configuration.ts backend_nest/.env.example
git commit -m "fix: 对齐POST/DELETE状态码和CORS配置(I-11/I-12/I-35)"
```

---

## Task 2: 数据库 Schema 对齐（I1-I10）

**Files:**
- Modify: `backend_nest/src/modules/workflows/entities/workflow-node.entity.ts`
- Modify: `backend_nest/src/modules/workflows/entities/workflow-edge.entity.ts`
- Modify: `backend_nest/src/modules/projects/entities/project.entity.ts`
- Modify: `backend_nest/src/modules/render/entities/render-task.entity.ts`
- Modify: `backend_nest/src/modules/snapshots/entities/project-snapshot.entity.ts`
- Modify: `backend_nest/src/modules/invitations/entities/project-invitation.entity.ts`
- Modify: `backend_nest/src/modules/media/entities/media-asset.entity.ts`

**Interfaces:**
- Consumes: Python 模型声明（真相源）
- Produces: NestJS 实体声明对齐 Python 模型

**背景（Python 真相源）：**
- `workflow_nodes`: position_x/y 默认 0.0（float8/double precision），label nullable，config nullable
- `projects.template_tags`: JSON（非 jsonb）
- `render_tasks.status`: 默认 'pending'，CHECK 约束 `status IN ('pending','running','completed','failed','cancelled')`
- `project_snapshots.source`: String(16)
- `project_invitations.expires_at`: nullable DateTime（timestamp，非 timestamptz）
- 外键 CASCADE: snapshots.project_id、invitations.project_id 声明 ondelete CASCADE

- [ ] **Step 1: 修改 workflow-node.entity.ts（I1/I2/I3/I9）**

```typescript
// backend_nest/src/modules/workflows/entities/workflow-node.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, JoinColumn, ManyToOne } from 'typeorm';

@Entity('workflow_nodes')
export class WorkflowNode {
  @PrimaryColumn({ length: 128 }) id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'node_type', length: 64 }) nodeType: string;
  // I2: label nullable（对齐 Python Mapped[str | None]）
  @Column({ length: 128, nullable: true }) label: string | null;
  // I1/I9: position_x/y 默认 0，类型 double precision（float8，对齐 Python Float）
  @Column({ name: 'position_x', type: 'double precision', default: 0 }) positionX: number;
  @Column({ name: 'position_y', type: 'double precision', default: 0 }) positionY: number;
  // I3: config nullable（对齐 Python Mapped[dict | None]）
  @Column({ type: 'json', nullable: true }) config: any | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

- [ ] **Step 2: 修改 project.entity.ts（I4）**

```typescript
// backend_nest/src/modules/projects/entities/project.entity.ts
  // I4: template_tags jsonb → json（对齐 Python JSON）
  @Column({ name: 'template_tags', type: 'json', nullable: true }) templateTags: any;
```

- [ ] **Step 3: 修改 render-task.entity.ts（I5/I6/I10）**

```typescript
// backend_nest/src/modules/render/entities/render-task.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Check, JoinColumn, ManyToOne } from 'typeorm';
import { Project } from '../../projects/entities/project.entity';

@Entity('render_tasks')
// I6: CHECK 约束（对齐 Python render_task.py:18-21）
@Check(`status IN ('pending', 'running', 'completed', 'failed', 'cancelled')`)
export class RenderTask {
  @PrimaryColumn('uuid') id: string;
  // I10: 外键 CASCADE 声明（对齐 project_memory 硬约束：项目删除级联删除 render_tasks）
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'node_id', length: 128, nullable: true }) nodeId: string;
  @Column({ name: 'node_params', type: 'jsonb', nullable: true }) nodeParams: any;
  @Column({ name: 'task_type', length: 64 }) taskType: string;
  // I5: status 默认 'pending'（对齐 Python default="pending"）
  @Column({ length: 32, default: 'pending' }) status: string;
  @Column({ type: 'int', default: 0 }) progress: number;
  @Column({ name: 'celery_task_id', length: 256, nullable: true }) celeryTaskId: string;
  @Column({ name: 'result_url', length: 512, nullable: true }) resultUrl: string;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

- [ ] **Step 4: 修改 project-snapshot.entity.ts（I7/I10）**

```typescript
// backend_nest/src/modules/snapshots/entities/project-snapshot.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, JoinColumn, ManyToOne } from 'typeorm';
import { Project } from '../../projects/entities/project.entity';

@Entity('project_snapshots')
export class ProjectSnapshot {
  @PrimaryColumn('uuid') id: string;
  // I10: 外键 CASCADE（对齐 Python project_snapshot.py:24 ondelete="CASCADE"）
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  // I7: source 长度 64 → 16（对齐 Python String(16)）
  @Column({ length: 16 }) source: string;
  @Column({ length: 128, nullable: true }) label: string;
  @Column({ length: 100, nullable: true }) name: string;
  @Column({ name: 'snapshot_data', type: 'jsonb' }) snapshotData: any;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

- [ ] **Step 5: 修改 project-invitation.entity.ts（I8/I10）**

```typescript
// backend_nest/src/modules/invitations/entities/project-invitation.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('project_invitations')
@Index(['token'], { unique: true })
export class ProjectInvitation {
  @PrimaryColumn('uuid') id: string;
  // I10: 外键 CASCADE（对齐 Python project_invitation.py:16 ondelete="CASCADE"）
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ length: 64 }) token: string;
  @Column({ length: 20, default: 'editor' }) role: string;
  // I8: timestamptz → timestamp（对齐 Python DateTime 无 timezone）
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true }) expiresAt: Date | null;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy: string;
  @Column({ name: 'used_by', type: 'uuid', nullable: true }) usedBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

- [ ] **Step 6: 类型检查 + 测试**

Run: `cd backend_nest && npx tsc --noEmit && npx jest`
Expected: 0 tsc 错误，13/13 jest 通过

注意：由于 `synchronize: false`，实体声明修改不影响 DB。但 `workflow-node.entity.ts` 的 `label` 改为 `string | null` 后，引用 label 的代码需确认兼容（workflows.service.ts 的 createNode 可能传 undefined，TypeORM 会存 NULL）。

- [ ] **Step 7: Commit**

```bash
git add backend_nest/src/modules/*/entities/*.entity.ts
git commit -m "fix: 对齐数据库Schema声明(I1-I10)"
```

---

## Task 3: API 路由对齐（I-13 到 I-20）

**Files:**
- Modify: `backend_nest/src/modules/auth/auth.service.ts`
- Modify: `backend_nest/src/modules/ai/ai.controller.ts`
- Modify: `backend_nest/src/modules/ai/ai.service.ts`
- Modify: `backend_nest/src/modules/ai/dto/ai.dto.ts`
- Modify: `backend_nest/src/modules/snapshots/snapshots.service.ts`
- Modify: `backend_nest/src/modules/snapshots/snapshots.module.ts`（注入 Project repo）
- Modify: `backend_nest/src/modules/projects/projects.service.ts`
- Modify: `backend_nest/src/modules/workflows/workflows.service.ts`
- Modify: `backend_nest/src/modules/media/media.service.ts`
- Modify: `backend_nest/src/modules/render/render.service.ts`

**Interfaces:**
- Consumes: Task 2 的实体修改（label nullable 等）
- Produces: API 行为对齐 Python

- [ ] **Step 1: I-13 注册冲突 409 → 400**

```typescript
// backend_nest/src/modules/auth/auth.service.ts
// 将 register 方法中的 ConflictException 改为 BadRequestException
import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';

// register 方法中：
// 用户名已存在：throw new ConflictException('用户名已存在')
// → throw new BadRequestException('用户名已存在')
// 邮箱已存在：throw new ConflictException('邮箱已被注册')
// → throw new BadRequestException('邮箱已被注册')
```

- [ ] **Step 2: I-14 所有权校验 403 → 404**

将以下 service 中的 `ForbiddenException('无权...')` 改为 `NotFoundException('项目不存在')`（对齐 Python `_verify_project_owner` 返回 404 不泄露存在性）：

```typescript
// projects.service.ts: get/update/delete/uploadCover/downloadCover 中的
// if (project.ownerId !== userId) throw new ForbiddenException('无权...');
// → if (project.ownerId !== userId) throw new NotFoundException('项目不存在');

// workflows.service.ts: 所有项目所有权校验
// if (project.ownerId !== userId) throw new ForbiddenException('无权...');
// → throw new NotFoundException('项目不存在');

// media.service.ts: get/getPresign/download/delete 中的
// if (media.ownerId !== userId) throw new ForbiddenException('无权...');
// → throw new NotFoundException('媒体资产不存在');

// render.service.ts: 已在 Task 4 (Critical) 修复为 404，确认即可
// snapshots.service.ts: list/getLatest/get/delete/restore 中的 ownerId 校验
// → throw new NotFoundException('快照不存在') 或 '项目不存在'
```

注意：只改项目/资源所有权校验，不改邀请协作者权限校验（如 listCollaborators 的 ForbiddenException 保持，因为那是权限问题不是所有权）。

- [ ] **Step 3: I-15 AI 模型列表加 model_type 筛选**

```typescript
// backend_nest/src/modules/ai/ai.controller.ts
  @Get('models')
  listModels(
    @CurrentUser() userId: string,
    @Query('provider_id') providerId?: string,
    @Query('model_type') modelType?: string,
  ) {
    return this.aiService.listModels(userId, providerId, modelType);
  }

// backend_nest/src/modules/ai/ai.service.ts
  async listModels(userId: string, providerId?: string, modelType?: string) {
    const qb = this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId });
    if (providerId) qb.andWhere('model.provider_id = :providerId', { providerId });
    if (modelType) qb.andWhere('model.model_type = :modelType', { modelType });
    qb.orderBy('model.created_at', 'DESC');
    const models = await qb.getMany();
    return models.map(m => this.modelToResponse(m));
  }
```

- [ ] **Step 4: I-16 Provider 列表自动初始化默认配置**

```typescript
// backend_nest/src/modules/ai/ai.service.ts
  async listProviders(userId: string) {
    // I-16: 自动初始化默认配置（对齐 Python ai.py:107 ensure_default_ai_config）
    await this.ensureDefaultAiConfig(userId);
    const providers = await this.providerRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return providers.map(p => this.providerToResponse(p));
  }
```

- [ ] **Step 5: I-17 默认模型查询加回退逻辑**

```typescript
// backend_nest/src/modules/ai/ai.service.ts
  async getDefaultModel(userId: string, modelType?: string) {
    // 1. 优先查找 is_default=True 的模型
    const qb = this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('provider.is_active = true')
      .andWhere('model.is_default = true')
      .andWhere('model.is_active = true');
    if (modelType) qb.andWhere('model.model_type = :modelType', { modelType });
    let model = await qb.getOne();

    // I-17: 无默认模型则回退到第一个 active 模型（对齐 Python ai.py:320-331）
    if (!model) {
      const fallbackQb = this.modelRepo
        .createQueryBuilder('model')
        .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
        .where('provider.user_id = :userId', { userId })
        .andWhere('provider.is_active = true')
        .andWhere('model.is_active = true');
      if (modelType) fallbackQb.andWhere('model.model_type = :modelType', { modelType });
      fallbackQb.orderBy('model.created_at', 'DESC').limit(1);
      model = await fallbackQb.getOne();
    }

    if (!model) {
      const typeHint = modelType ? `（类型: ${modelType}）` : '';
      throw new NotFoundException(`未找到可用的 AI 模型${typeHint}，请先在设置页配置`);
    }
    return this.modelToResponse(model);
  }
```

- [ ] **Step 6: I-18 模型更新支持 provider_id/model_id/model_type**

```typescript
// backend_nest/src/modules/ai/dto/ai.dto.ts
export class ModelUpdateDto {
  @IsString() @IsOptional() provider_id?: string;
  @IsString() @IsOptional() model_id?: string;
  @IsString() @IsOptional() display_name?: string;
  @IsString() @IsOptional() model_type?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsBoolean() @IsOptional() is_default?: boolean;
}

// backend_nest/src/modules/ai/ai.service.ts — updateModel 方法补充字段
  async updateModel(userId: string, modelId: string, dto: ModelUpdateDto) {
    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('model.id = :modelId', { modelId })
      .andWhere('provider.user_id = :userId', { userId })
      .getOne();
    if (!model) throw new NotFoundException('AI 模型不存在');

    // I-18: 支持修改 provider_id（对齐 Python ai.py:243-253）
    if (dto.provider_id !== undefined) {
      const newProvider = await this.providerRepo.findOne({
        where: { id: dto.provider_id, userId },
      });
      if (!newProvider) throw new NotFoundException('AI 服务商不存在');
      model.providerId = dto.provider_id;
    }
    if (dto.model_id !== undefined) model.modelId = dto.model_id;
    if (dto.display_name !== undefined) model.displayName = dto.display_name;
    if (dto.model_type !== undefined) model.modelType = dto.model_type;

    if (dto.is_default) {
      await this.modelRepo
        .createQueryBuilder()
        .update(AiModel)
        .set({ isDefault: false })
        .where('model_type = :modelType', { modelType: model.modelType })
        .andWhere('id != :modelId', { modelId })
        .andWhere(`provider_id IN (SELECT id FROM ai_providers WHERE user_id = :userId)`, { userId })
        .execute();
    }
    if (dto.is_active !== undefined) model.isActive = dto.is_active;
    if (dto.is_default !== undefined) model.isDefault = dto.is_default;
    await this.modelRepo.save(model);
    return this.modelToResponse(model);
  }
```

- [ ] **Step 7: I-19 字幕解析失败 409 → 422**

```typescript
// backend_nest/src/modules/ai/ai.service.ts — generateSubtitles 方法
import { HttpException, HttpStatus } from '@nestjs/common';

// 将 ConflictException 改为 HttpException(422)（对齐 Python ai.py:484,488）
// throw new ConflictException(`AI 返回格式异常: ...`)
// → throw new HttpException({ detail: `AI 返回格式异常: ${(e as Error).message}` }, 422);
// throw new ConflictException('AI 未生成字幕分段')
// → throw new HttpException({ detail: 'AI 未生成字幕分段' }, 422);
```

- [ ] **Step 8: I-20 快照恢复更新 project.updated_at**

```typescript
// backend_nest/src/modules/snapshots/snapshots.service.ts
import { Project } from '../projects/entities/project.entity';
// 注入 Project repo（需在 snapshots.module.ts 的 TypeOrmModule.forFeature 加入 Project）

  async restore(userId: string, snapshotId: string) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId, ownerId: userId } });
    if (!snapshot) throw new NotFoundException('快照不存在');

    const data = snapshot.snapshotData;
    const nodes = data.nodes || [];
    const edges = data.edges || [];

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(WorkflowEdge, { projectId: snapshot.projectId });
      await manager.delete(WorkflowNode, { projectId: snapshot.projectId });

      if (nodes.length > 0) {
        const nodeEntities = nodes.map((n: any) => ({
          id: n.id,
          projectId: snapshot.projectId,
          nodeType: n.node_type || n.nodeType,
          label: n.label,
          positionX: n.position_x || n.positionX,
          positionY: n.position_y || n.positionY,
          config: n.config,
        }));
        await manager.insert(WorkflowNode, nodeEntities);
      }

      if (edges.length > 0) {
        const edgeEntities = edges.map((e: any) => ({
          id: e.id,
          projectId: snapshot.projectId,
          sourceNodeId: e.source_node_id || e.sourceNodeId,
          targetNodeId: e.target_node_id || e.targetNodeId,
          sourcePort: e.source_port || e.sourcePort || undefined,
          targetPort: e.target_port || e.targetPort || undefined,
        }));
        await manager.insert(WorkflowEdge, edgeEntities);
      }

      // I-20: 刷新 project.updated_at（对齐 Python snapshots.py:264-270）
      await manager.update(Project, { id: snapshot.projectId }, { updatedAt: new Date() });
    });

    return {
      restored: true,
      project_id: snapshot.projectId,
      nodes_count: nodes.length,
      edges_count: edges.length,
    };
  }
```

```typescript
// backend_nest/src/modules/snapshots/snapshots.module.ts
import { Project } from '../projects/entities/project.entity';
// TypeOrmModule.forFeature([...现有, Project])
```

- [ ] **Step 9: 类型检查 + 测试**

Run: `cd backend_nest && npx tsc --noEmit && npx jest`
Expected: 0 tsc 错误，13/13 jest 通过

- [ ] **Step 10: Commit**

```bash
git add backend_nest/src/modules/
git commit -m "fix: 对齐API路由行为(I-13到I-20)"
```

---

## Task 4: 服务层逻辑对齐（I-21/I-22/I-23/I-25/I-26/I-27/I-28）

**Files:**
- Modify: `backend_nest/src/modules/projects/projects.service.ts`
- Modify: `backend_nest/src/modules/projects/projects.controller.ts`
- Modify: `backend_nest/src/modules/ai/ai.service.ts`
- Modify: `backend_nest/src/modules/media/media.service.ts`
- Modify: `backend_nest/src/modules/snapshots/snapshots.service.ts`
- Modify: `backend_nest/src/modules/invitations/invitations.service.ts`
- Modify: `backend_nest/src/modules/ai/dto/ai.dto.ts`

- [ ] **Step 1: I-21 项目列表移除 is_template 过滤**

```typescript
// backend_nest/src/modules/projects/projects.service.ts — list 方法
  async list(userId: string) {
    // I-21: 移除 isTemplate: false 过滤（对齐 Python projects.py 不过滤）
    const projects = await this.projectRepo.find({
      where: { ownerId: userId },
      order: { updatedAt: 'DESC' },
    });
    // ... 其余不变
  }
```

- [ ] **Step 2: I-22 封面上传加文件类型与大小校验**

```typescript
// backend_nest/src/modules/projects/projects.service.ts — uploadCover 方法
import { BadRequestException } from '@nestjs/common';

  async uploadCover(userId: string, projectId: string, file: Express.Multer.File) {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.ownerId !== userId) throw new NotFoundException('项目不存在');

    // I-22: 文件类型与大小校验（对齐 Python projects.py:158-169）
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('封面必须是图片格式(png/jpeg/webp/gif)');
    }
    const maxSize = 5 * 1024 * 1024;  // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException('封面图片大小不能超过 5MB');
    }

    const objectName = `covers/${projectId}.png`;
    await this.minioService.uploadFile(objectName, file.buffer, file.mimetype || 'image/png');
    project.coverUrl = `/api/v1/projects/${projectId}/cover/download`;
    await this.projectRepo.save(project);
    return { cover_url: project.coverUrl };
  }
```

- [ ] **Step 3: I-23 AI 错误消息保留原始信息**

```typescript
// backend_nest/src/modules/ai/ai.service.ts
// callVideoGen catch 块（L381-384）：
//   throw new Error(`AI 服务暂时不可用，请稍后重试`);
//   → throw new Error(`视频生成 API 调用失败: ${(err as Error).message}`);
// callAudioGen catch 块（L419-422）：
//   throw new Error(`AI 服务暂时不可用，请稍后重试`);
//   → throw new Error(`TTS API 调用失败: ${(err as Error).message}`);
// callLlm catch 块（L435-438）：
//   throw new Error(`AI 服务暂时不可用，请稍后重试`);
//   → throw new Error(`LLM API 调用失败: ${(err as Error).message}`);
```

- [ ] **Step 4: I-25 媒体删除 MinIO 容错**

```typescript
// backend_nest/src/modules/media/media.service.ts — delete 方法
  async delete(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new NotFoundException('媒体资产不存在');

    // I-25: 先删 DB 再删 MinIO（容错，对齐 Python：DB 删除不被 MinIO 失败阻止）
    await this.mediaRepo.delete({ id: mediaId });
    try {
      await this.minioService.deleteObject(media.storageKey);
    } catch (err) {
      // MinIO 删除失败仅记录日志，不阻止 DB 删除
      console.warn(`MinIO 删除失败 mediaId=${mediaId}: ${(err as Error).message}`);
    }
  }
```

- [ ] **Step 5: I-26 快照 auto 上限删 1 条**

```typescript
// backend_nest/src/modules/snapshots/snapshots.service.ts — create 方法
  async create(userId: string, projectId: string, dto: SnapshotCreateDto) {
    // I-26: auto 源受 5 条上限，只删 1 条最旧的（对齐 Python snapshots.py:91-97）
    if (dto.source === 'auto') {
      const autoCount = await this.snapshotRepo.count({ where: { projectId, source: 'auto' } });
      if (autoCount >= 5) {
        // 删除最旧的 1 条 auto 快照
        const oldest = await this.snapshotRepo.findOne({
          where: { projectId, source: 'auto' },
          order: { createdAt: 'ASC' },
        });
        if (oldest) {
          await this.snapshotRepo.delete({ id: oldest.id });
        }
      }
    }
    // ... 其余创建逻辑不变
  }
```

- [ ] **Step 6: I-27 邀请 role 校验**

```typescript
// backend_nest/src/modules/invitations/invitations.service.ts
import { BadRequestException } from '@nestjs/common';

  private validateRole(role: string): void {
    // I-27: 校验 role 合法性（对齐 project_memory: 3 permission levels）
    const validRoles = ['editor', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException('角色必须是 editor 或 viewer');
    }
  }

  // createInvitation 方法中，在创建前调用：
  // this.validateRole(dto.role);

  // updateCollaboratorRole 方法中，在更新前调用：
  // this.validateRole(role);
```

- [ ] **Step 7: I-28 Provider 更新支持 platform**

```typescript
// backend_nest/src/modules/ai/dto/ai.dto.ts
export class ProviderUpdateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() platform?: string;  // I-28: 新增 platform
  @IsString() @IsOptional() base_url?: string;
  @IsString() @IsOptional() api_key?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

// backend_nest/src/modules/ai/ai.service.ts — updateProvider 方法
  async updateProvider(userId: string, providerId: string, dto: ProviderUpdateDto) {
    const provider = await this.providerRepo.findOne({ where: { id: providerId, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');
    if (dto.name !== undefined) provider.name = dto.name;
    if (dto.platform !== undefined) provider.platform = dto.platform;  // I-28
    if (dto.base_url !== undefined) provider.baseUrl = dto.base_url;
    if (dto.api_key !== undefined) provider.apiKey = dto.api_key;
    if (dto.is_active !== undefined) provider.isActive = dto.is_active;
    await this.providerRepo.save(provider);
    return this.providerToResponse(provider);
  }
```

- [ ] **Step 8: 类型检查 + 测试**

Run: `cd backend_nest && npx tsc --noEmit && npx jest`
Expected: 0 tsc 错误，13/13 jest 通过

- [ ] **Step 9: Commit**

```bash
git add backend_nest/src/modules/
git commit -m "fix: 对齐服务层逻辑(I-21到I-28)"
```

---

## Task 5: 异步任务 + WebSocket 对齐（I-29/I-30/I-32/I-34）

**Files:**
- Modify: `backend_nest/src/queue/queue.module.ts`
- Modify: `backend_nest/src/queue/render.processor.ts`
- Modify: `backend_nest/src/ws/node-lock.service.ts`

- [ ] **Step 1: I-29/I-30 BullMQ 重试 attempts 3 → 1**

```typescript
// backend_nest/src/queue/queue.module.ts
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('redis.url') },
        defaultJobOptions: {
          // I-29: 不重试（对齐 Python Celery 默认不重试），同时解决 I-30 status 跳变
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
```

- [ ] **Step 2: I-32 无 model_id 时获取默认模型**

```typescript
// backend_nest/src/queue/render.processor.ts — executeAiTask 方法
  private async executeAiTask(
    task: RenderTask,
    job: Job,
    params: { modelId?: string; prompt?: string; inputArtifacts?: any[]; nodeParams?: any },
  ) {
    await this.checkCancelled(job, task);

    const userId = task.ownerId;
    const nodeParams = params.nodeParams || {};
    const prompt = params.prompt || nodeParams.prompt || nodeParams.text || '';
    let modelId = params.modelId || nodeParams.model_id;
    const inputArtifacts = params.inputArtifacts || [];

    // I-32: 无 model_id 时尝试获取默认模型（对齐 Python：不直接报错）
    if (!modelId) {
      // 根据 task_type 推断 model_type
      const taskTypeToModelType: Record<string, string> = {
        ai_text2img: 'image_gen',
        ai_img2img: 'image_gen',
        ai_text2video: 'video_gen',
        ai_img2video: 'video_gen',
        ai_tts: 'tts',
      };
      const modelType = taskTypeToModelType[task.taskType] || 'llm';
      try {
        const defaultModel = await this.aiService.getDefaultModel(userId, modelType);
        modelId = defaultModel.id;
        this.logger.log(`任务 ${task.id} 无 model_id，使用默认 ${modelType} 模型: ${modelId}`);
      } catch (err) {
        throw new Error(`AI 任务缺少 model_id 且无默认模型可用: ${(err as Error).message}`);
      }
    }

    await job.updateProgress(10);
    // ... 其余逻辑不变
  }
```

- [ ] **Step 3: I-34 renew_lock 允许续租过期锁**

```typescript
// backend_nest/src/ws/node-lock.service.ts — renew 方法
  renew(projectId: string, nodeId: string, sid: string): NodeLock | null {
    const key = this.lockKey(projectId, nodeId);
    const lock = this.locks.get(key);
    // I-34: 移除 isExpired 检查，允许续租过期锁（对齐 Python collaboration.py:472-483）
    // Python renew_lock 直接从 _node_locks.get() 取锁，不检查过期，只要 sid 匹配就续租
    if (!lock || lock.sid !== sid) {
      if (lock) this.locks.delete(key);
      return null;
    }
    const now = Date.now() / 1000;
    lock.lastRenewed = now;
    lock.expiresAt = now + this.LOCK_TTL;
    return lock;
  }
```

- [ ] **Step 4: 类型检查 + 测试**

Run: `cd backend_nest && npx tsc --noEmit && npx jest`
Expected: 0 tsc 错误，13/13 jest 通过

- [ ] **Step 5: Commit**

```bash
git add backend_nest/src/queue/queue.module.ts backend_nest/src/queue/render.processor.ts backend_nest/src/ws/node-lock.service.ts
git commit -m "fix: 对齐异步任务和WebSocket行为(I-29/I-30/I-32/I-34)"
```

---

## 验证清单

- [ ] `npx tsc --noEmit` 0 错误
- [ ] `npx jest` 13/13 通过
- [ ] 所有 POST 返回 200（非 201）
- [ ] 非 AI DELETE 返回 204 无 body
- [ ] CORS 支持 JSON 数组格式
- [ ] 数据库实体声明对齐 Python 模型
- [ ] 注册冲突返回 400
- [ ] 所有权校验返回 404
- [ ] AI 模型列表支持 model_type 筛选
- [ ] 默认模型有回退逻辑
- [ ] 快照恢复更新 project.updated_at
- [ ] 项目列表不过滤 is_template
- [ ] 封面上传有类型和大小校验
- [ ] AI 错误消息保留原始信息
- [ ] 媒体删除 MinIO 容错
- [ ] 快照 auto 上限删 1 条
- [ ] 邀请 role 校验
- [ ] Provider 更新支持 platform
- [ ] BullMQ 不重试
- [ ] 无 model_id 时获取默认模型
- [ ] renew_lock 允许续租过期锁
