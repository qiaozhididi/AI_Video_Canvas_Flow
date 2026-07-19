// test/unit/snapshots.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SnapshotsService } from '../../src/modules/snapshots/snapshots.service';
import { ProjectSnapshot } from '../../src/modules/snapshots/entities/project-snapshot.entity';
import { Project } from '../../src/modules/projects/entities/project.entity';
import { WorkflowNode } from '../../src/modules/workflows/entities/workflow-node.entity';
import { WorkflowEdge } from '../../src/modules/workflows/entities/workflow-edge.entity';
import { ProjectAccessService } from '../../src/common/auth/project-access.service';

describe('SnapshotsService', () => {
  let service: SnapshotsService;
  let snapshotRepo: any;
  let dataSource: any;
  let projectAccess: any;
  let manager: any;

  beforeEach(async () => {
    // 仓库 mock：覆盖 findOne/find/count/create/save/delete
    snapshotRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
      delete: jest.fn(),
    };
    // 事务 manager mock：restore 与 create（M16 后）内通过 dataSource.transaction(cb) 注入
    manager = {
      query: jest.fn().mockResolvedValue(undefined), // M16: pg_advisory_xact_lock
      count: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((_entity, dto) => ({ ...dto, createdAt: new Date('2024-01-01T00:00:00Z') })),
      save: jest.fn(),
      delete: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn((cb) => cb(manager)),
    };
    // 权限服务 mock
    projectAccess = {
      verifyAccess: jest.fn().mockResolvedValue(undefined),
      verifyEditAccess: jest.fn().mockResolvedValue(undefined),
      verifyOwner: jest.fn().mockResolvedValue(undefined),
    };

    // M15: ConfigService mock，提供 limits.snapshot.autoMaxCount 默认值
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'limits.snapshot.autoMaxCount') return 5;
        return undefined;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SnapshotsService,
        { provide: getRepositoryToken(ProjectSnapshot), useValue: snapshotRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: ProjectAccessService, useValue: projectAccess },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = moduleRef.get<SnapshotsService>(SnapshotsService);
  });

  // 构造测试快照样本
  const makeSnapshot = (overrides: any = {}) => ({
    id: 'snap-1',
    projectId: 'proj-1',
    ownerId: 'user-1',
    source: 'manual',
    label: 'v1',
    name: 'first',
    snapshotData: { nodes: [], edges: [] },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  describe('list', () => {
    it('正常返回快照列表，且 select 不含 snapshot_data 字段', async () => {
      snapshotRepo.find.mockResolvedValue([makeSnapshot()]);
      await service.list('user-1', 'proj-1');
      const callArg = snapshotRepo.find.mock.calls[0][0];
      expect(callArg.select).toEqual([
        'id', 'projectId', 'ownerId', 'source', 'label', 'name', 'createdAt',
      ]);
      expect(callArg.select).not.toContain('snapshotData');
    });

    it('source 筛选参数应正确传递到 where', async () => {
      snapshotRepo.find.mockResolvedValue([]);
      await service.list('user-1', 'proj-1', 'auto');
      expect(snapshotRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'proj-1', source: 'auto' } }),
      );
    });

    it('应调用 projectAccess.verifyAccess', async () => {
      snapshotRepo.find.mockResolvedValue([]);
      await service.list('user-1', 'proj-1');
      expect(projectAccess.verifyAccess).toHaveBeenCalledWith('user-1', 'proj-1');
    });

    it('返回结果不含 snapshot_data 字段', async () => {
      snapshotRepo.find.mockResolvedValue([makeSnapshot()]);
      const result = await service.list('user-1', 'proj-1');
      expect(result[0]).not.toHaveProperty('snapshot_data');
      expect(result[0]).toEqual({
        id: 'snap-1',
        project_id: 'proj-1',
        owner_id: 'user-1',
        source: 'manual',
        label: 'v1',
        name: 'first',
        created_at: '2024-01-01T00:00:00.000Z',
      });
    });
  });

  describe('getLatest', () => {
    it('正常返回最新快照，含 snapshot_data', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      const result = await service.getLatest('user-1', 'proj-1');
      expect(result.snapshot_data).toEqual({ nodes: [], edges: [] });
      expect(snapshotRepo.findOne).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        order: { createdAt: 'DESC' },
      });
    });

    it('无快照时抛出 NotFoundException', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      await expect(service.getLatest('user-1', 'proj-1')).rejects.toThrow(NotFoundException);
    });

    it('应调用 projectAccess.verifyAccess', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      await service.getLatest('user-1', 'proj-1');
      expect(projectAccess.verifyAccess).toHaveBeenCalledWith('user-1', 'proj-1');
    });
  });

  describe('get', () => {
    it('正常返回快照详情，含 snapshot_data', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      const result = await service.get('user-1', 'snap-1');
      expect(result.snapshot_data).toEqual({ nodes: [], edges: [] });
      expect(result.id).toBe('snap-1');
    });

    it('快照不存在时抛出 NotFoundException', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      await expect(service.get('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it("正常创建 manual 快照", async () => {
      // M16: create 改为事务内执行，manager.save 替代 snapshotRepo.save
      manager.save.mockResolvedValue(makeSnapshot({ source: 'manual' }));
      const result = await service.create('user-1', 'proj-1', {
        source: 'manual',
        label: 'v1',
        name: 'first',
        snapshot_data: { nodes: [], edges: [] },
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['proj-1']);
      expect(result.source).toBe('manual');
    });

    it("source='auto' 且已达 5 条上限时，删除最旧 1 条", async () => {
      manager.count.mockResolvedValue(5);
      const oldest = makeSnapshot({
        id: 'oldest-snap',
        source: 'auto',
        createdAt: new Date('2023-01-01T00:00:00Z'),
      });
      manager.findOne.mockResolvedValue(oldest); // 用于查询最旧快照
      manager.save.mockResolvedValue(makeSnapshot({ source: 'auto' }));

      await service.create('user-1', 'proj-1', {
        source: 'auto',
        snapshot_data: { nodes: [], edges: [] },
      });

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(ProjectSnapshot, { id: 'oldest-snap' });
    });

    it("source='auto' 且未达上限时，不删除", async () => {
      manager.count.mockResolvedValue(2);
      manager.save.mockResolvedValue(makeSnapshot({ source: 'auto' }));

      await service.create('user-1', 'proj-1', {
        source: 'auto',
        snapshot_data: { nodes: [], edges: [] },
      });

      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('应调用 projectAccess.verifyEditAccess', async () => {
      manager.save.mockResolvedValue(makeSnapshot());
      await service.create('user-1', 'proj-1', {
        source: 'manual',
        snapshot_data: {},
      });
      expect(projectAccess.verifyEditAccess).toHaveBeenCalledWith('user-1', 'proj-1');
    });
  });

  describe('restore', () => {
    it('正常恢复快照：删除旧 nodes/edges 并插入新数据', async () => {
      const snapshot = makeSnapshot({
        snapshotData: {
          nodes: [
            { id: 'n1', node_type: 'start', label: '开始', position_x: 10, position_y: 20, config: {} },
          ],
          edges: [
            { id: 'e1', source_node_id: 'n1', target_node_id: 'n2', source_port: 'p1', target_port: 'p2' },
          ],
        },
      });
      snapshotRepo.findOne.mockResolvedValue(snapshot);

      const result = await service.restore('user-1', 'snap-1');

      // 先删除旧 edges 和 nodes
      expect(manager.delete).toHaveBeenCalledTimes(2);
      // 再插入新 nodes 和 edges
      expect(manager.insert).toHaveBeenCalledTimes(2);
      // m4: 验证字段映射（node_type → nodeType, position_x → positionX 等驼峰转换 + 兼容 fallback）
      expect(manager.insert).toHaveBeenNthCalledWith(1, WorkflowNode, expect.arrayContaining([
        expect.objectContaining({
          id: 'n1',
          projectId: 'proj-1',
          nodeType: 'start',
          label: '开始',
          positionX: 10,
          positionY: 20,
          config: {},
        }),
      ]));
      expect(manager.insert).toHaveBeenNthCalledWith(2, WorkflowEdge, expect.arrayContaining([
        expect.objectContaining({
          id: 'e1',
          projectId: 'proj-1',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          sourcePort: 'p1',
          targetPort: 'p2',
        }),
      ]));
      // 事务内通过 manager.update 刷新 project.updated_at
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        Project,
        { id: 'proj-1' },
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
      // 返回结构
      expect(result).toEqual({
        restored: true,
        project_id: 'proj-1',
        nodes_count: 1,
        edges_count: 1,
      });
    });

    it('快照不存在时抛出 NotFoundException', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      await expect(service.restore('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('应调用 projectAccess.verifyEditAccess', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      await service.restore('user-1', 'snap-1');
      expect(projectAccess.verifyEditAccess).toHaveBeenCalledWith('user-1', 'proj-1');
    });

    it('事务内应通过 manager.update 更新 project.updated_at', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      await service.restore('user-1', 'snap-1');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        Project,
        { id: 'proj-1' },
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
    });

    it('m4: 空 nodes/edges 时不调用 manager.insert（但仍删除旧数据 + 更新 project.updated_at）', async () => {
      const snapshot = makeSnapshot({
        snapshotData: { nodes: [], edges: [] },
      });
      snapshotRepo.findOne.mockResolvedValue(snapshot);

      const result = await service.restore('user-1', 'snap-1');

      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.delete).toHaveBeenCalledTimes(2);
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        restored: true,
        project_id: 'proj-1',
        nodes_count: 0,
        edges_count: 0,
      });
    });
  });

  describe('delete', () => {
    it('正常删除快照', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      await service.delete('user-1', 'snap-1');
      expect(snapshotRepo.delete).toHaveBeenCalledWith({ id: 'snap-1' });
    });

    it('快照不存在时抛出 NotFoundException', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('应调用 projectAccess.verifyEditAccess', async () => {
      snapshotRepo.findOne.mockResolvedValue(makeSnapshot());
      await service.delete('user-1', 'snap-1');
      expect(projectAccess.verifyEditAccess).toHaveBeenCalledWith('user-1', 'proj-1');
    });
  });
});
