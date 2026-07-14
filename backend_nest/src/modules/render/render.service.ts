// src/modules/render/render.service.ts
import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RenderTask } from './entities/render-task.entity';
import { RenderTaskCreateDto, ExportRequestDto } from './dto/render.dto';
import { QueueService } from '../../queue/queue.service';

// 队列服务接口 (Task 15 实现，此处通过依赖注入)
export interface IQueueService {
  enqueueRenderTask(taskId: string, params: any): Promise<string>;
  cancelTask(jobId: string): Promise<void>;
}

@Injectable()
export class RenderService {
  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    private dataSource: DataSource,
    private queueService: QueueService,
  ) {}

  async list(userId: string, status?: string, limit = 50) {
    const where: any = { ownerId: userId };
    if (status) where.status = status;
    const tasks = await this.taskRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });

    // 批量查询 node_label 和 project_name
    const nodeIds = [...new Set(tasks.map(t => t.nodeId).filter(Boolean))];
    const projectIds = [...new Set(tasks.map(t => t.projectId))];

    let nodeLabels: Record<string, string> = {};
    if (nodeIds.length > 0) {
      const rows = await this.dataSource.query(
        `SELECT id, config FROM workflow_nodes WHERE id = ANY($1)`,
        [nodeIds],
      );
      nodeLabels = rows.reduce((acc, r) => {
        const config = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
        acc[r.id] = config?.label || r.id;
        return acc;
      }, {});
    }

    let projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const rows = await this.dataSource.query(
        `SELECT id, name FROM projects WHERE id = ANY($1::uuid[])`,
        [projectIds],
      );
      projectNames = rows.reduce((acc, r) => ({ ...acc, [r.id]: r.name }), {});
    }

    return tasks.map(t => this.toResponse(t,
      t.nodeId ? nodeLabels[t.nodeId] : undefined,
      projectNames[t.projectId],
    ));
  }

  async create(userId: string, dto: RenderTaskCreateDto) {
    const task = this.taskRepo.create({
      id: uuidv4(),
      projectId: dto.project_id,
      ownerId: userId,
      taskType: dto.task_type,
      status: 'pending',
      progress: 0,
      nodeId: dto.node_id || undefined,
    });
    await this.taskRepo.save(task);

    // 入队 BullMQ
    const jobId = await this.queueService.enqueueRenderTask(task.id, {
      modelId: dto.model_id,
      prompt: dto.prompt,
      inputArtifacts: dto.input_artifacts,
      nodeParams: dto.node_params,
    });

    // 回写 celery_task_id (复用列名，存储 BullMQ job ID)
    task.celeryTaskId = jobId;
    task.status = 'running';
    await this.taskRepo.save(task);

    return this.toResponse(task);
  }

  async get(userId: string, taskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('渲染任务不存在');
    if (task.ownerId !== userId) throw new ForbiddenException('无权访问此任务');
    return this.toResponse(task);
  }

  async cancel(userId: string, taskId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('渲染任务不存在');
    if (task.ownerId !== userId) throw new ForbiddenException('无权操作此任务');
    if (!['pending', 'running'].includes(task.status)) {
      throw new ConflictException('任务已完成，无法取消');
    }

    // 取消 BullMQ 任务
    if (task.celeryTaskId) {
      await this.queueService.cancelTask(task.celeryTaskId);
    }

    task.status = 'cancelled';
    await this.taskRepo.save(task);
    return this.toResponse(task);
  }

  async retry(userId: string, taskId: string) {
    const original = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!original) throw new NotFoundException('渲染任务不存在');
    if (original.ownerId !== userId) throw new ForbiddenException('无权操作此任务');
    if (!['failed', 'cancelled'].includes(original.status)) {
      throw new ConflictException('只能重试失败或已取消的任务');
    }

    // 从节点读取最新 node_params
    let nodeParams: any = null;
    if (original.nodeId) {
      const rows = await this.dataSource.query(
        `SELECT config FROM workflow_nodes WHERE id = $1`,
        [original.nodeId],
      );
      if (rows.length > 0) {
        const config = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config;
        nodeParams = config?.params;
      }
    }

    const newTask = this.taskRepo.create({
      id: uuidv4(),
      projectId: original.projectId,
      ownerId: original.ownerId,
      taskType: original.taskType,
      status: 'pending',
      progress: 0,
      nodeId: original.nodeId,
    });
    await this.taskRepo.save(newTask);

    const jobId = await this.queueService.enqueueRenderTask(newTask.id, {
      modelId: null,
      prompt: null,
      inputArtifacts: null,
      nodeParams,
    });

    newTask.celeryTaskId = jobId;
    newTask.status = 'running';
    await this.taskRepo.save(newTask);

    return this.toResponse(newTask);
  }

  async exportVideo(userId: string, dto: ExportRequestDto) {
    // 从最新快照获取 timeline_data
    const snapshotRows = await this.dataSource.query(
      `SELECT snapshot_data FROM project_snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [dto.project_id],
    );
    const timelineData = snapshotRows.length > 0
      ? (typeof snapshotRows[0].snapshot_data === 'string'
        ? JSON.parse(snapshotRows[0].snapshot_data) : snapshotRows[0].snapshot_data)?.timelineData || {}
      : {};

    const task = this.taskRepo.create({
      id: uuidv4(),
      projectId: dto.project_id,
      ownerId: userId,
      taskType: 'export',
      status: 'pending',
      progress: 0,
      nodeParams: {
        format: dto.format,
        resolution: dto.resolution,
        timeline_data: timelineData,
        subtitles: dto.subtitles,
      },
    });
    await this.taskRepo.save(task);

    await this.queueService.enqueueRenderTask(task.id, { nodeParams: task.nodeParams });
    return { task_id: task.id, status: 'pending' };
  }

  private toResponse(task: RenderTask, nodeLabel?: string, projectName?: string) {
    return {
      id: task.id,
      project_id: task.projectId,
      owner_id: task.ownerId,
      task_type: task.taskType,
      status: task.status,
      progress: task.progress,
      celery_task_id: task.celeryTaskId,
      result_url: task.resultUrl,
      error_message: task.errorMessage,
      node_id: task.nodeId,
      node_label: nodeLabel,
      project_name: projectName,
      created_at: task.createdAt?.toISOString(),
      updated_at: task.updatedAt?.toISOString(),
    };
  }
}
