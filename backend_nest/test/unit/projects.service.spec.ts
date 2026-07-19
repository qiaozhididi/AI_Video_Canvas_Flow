import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ProjectsService } from '../../src/modules/projects/projects.service';
import { Project } from '../../src/modules/projects/entities/project.entity';
import { MinioService } from '../../src/common/utils/minio.service';
import { ProjectAccessService } from '../../src/common/auth/project-access.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectRepo: any;
  let minioService: any;
  let dataSource: any;
  let projectAccess: any;

  beforeEach(async () => {
    // 对齐 auth.service.spec.ts：用 jest.fn() mock 所有依赖
    projectRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => ({
        ...dto,
        // m3: 含日期以便断言 toResponse 的 created_at/updated_at 转换逻辑
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      })),
      save: jest.fn(),
    };
    minioService = {
      uploadFile: jest.fn(),
      downloadObject: jest.fn(),
    };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn(),
    };
    projectAccess = {
      verifyAccess: jest.fn(),
      verifyEditAccess: jest.fn(),
      verifyOwner: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        { provide: MinioService, useValue: minioService },
        { provide: DataSource, useValue: dataSource },
        { provide: ProjectAccessService, useValue: projectAccess },
      ],
    }).compile();
    service = moduleRef.get<ProjectsService>(ProjectsService);
  });

  describe('list', () => {
    it('正常返回项目列表（含 nodeCount 批量查询）', async () => {
      const projects = [
        {
          id: 'p1', name: 'P1', description: 'd1', coverUrl: '/c1', ownerId: 'u1',
          createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
        {
          id: 'p2', name: 'P2', description: 'd2', coverUrl: '/c2', ownerId: 'u1',
          createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ];
      projectRepo.find.mockResolvedValue(projects);
      // 模拟 SQL 返回的 cnt 为字符串（pg 驱动行为）
      dataSource.query.mockResolvedValue([
        { project_id: 'p1', cnt: '3' },
        { project_id: 'p2', cnt: '5' },
      ]);

      const result = await service.list('u1', 10, 5);

      // 校验 find 参数（含分页 take/skip）
      expect(projectRepo.find).toHaveBeenCalledWith({
        where: { ownerId: 'u1' },
        order: { updatedAt: 'DESC' },
        take: 10,
        skip: 5,
      });
      // 校验 node_count 批量查询 SQL 与参数
      expect(dataSource.query).toHaveBeenCalledWith(
        `SELECT project_id, COUNT(*) as cnt FROM workflow_nodes WHERE project_id = ANY($1::uuid[]) GROUP BY project_id`,
        [['p1', 'p2']],
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'p1', name: 'P1', cover_url: '/c1', owner_id: 'u1', node_count: 3,
      });
      expect(result[1].node_count).toBe(5);
    });

    it('空列表时 nodeCounts 不查询', async () => {
      projectRepo.find.mockResolvedValue([]);

      const result = await service.list('u1');

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('分页参数传递（limit/offset）', async () => {
      projectRepo.find.mockResolvedValue([]);

      await service.list('u1', 20, 40);

      expect(projectRepo.find).toHaveBeenCalledWith(expect.objectContaining({
        take: 20,
        skip: 40,
      }));
    });
  });

  describe('get', () => {
    it('正常返回项目（含 nodeCount）', async () => {
      projectAccess.verifyAccess.mockResolvedValue(undefined);
      const project = {
        id: 'p1', name: 'P1', description: 'd', coverUrl: '/c', ownerId: 'u1',
        createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
      };
      projectRepo.findOne.mockResolvedValue(project);
      dataSource.query.mockResolvedValue([{ cnt: '7' }]);

      const result = await service.get('u1', 'p1');

      expect(projectAccess.verifyAccess).toHaveBeenCalledWith('u1', 'p1');
      expect(dataSource.query).toHaveBeenCalledWith(
        `SELECT COUNT(*) as cnt FROM workflow_nodes WHERE project_id = $1`,
        ['p1'],
      );
      expect(result.id).toBe('p1');
      expect(result.node_count).toBe(7);
      expect(result.name).toBe('P1');
    });

    it('调用 projectAccess.verifyAccess 进行权限校验', async () => {
      projectAccess.verifyAccess.mockResolvedValue(undefined);
      projectRepo.findOne.mockResolvedValue({
        id: 'p1', name: 'P1', description: '', coverUrl: null, ownerId: 'u1',
        createdAt: new Date(), updatedAt: new Date(),
      });
      dataSource.query.mockResolvedValue([{ cnt: '0' }]);

      await service.get('u1', 'p1');

      expect(projectAccess.verifyAccess).toHaveBeenCalledTimes(1);
      expect(projectAccess.verifyAccess).toHaveBeenCalledWith('u1', 'p1');
    });
  });

  describe('create', () => {
    it('正常创建项目（返回 toResponse）', async () => {
      projectRepo.save.mockResolvedValue(undefined);

      const result = await service.create('u1', { name: 'NewProj', description: 'desc' });

      // 校验 create 入参（id 由 uuidv4 生成，仅校验关键字段）
      expect(projectRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'NewProj',
        description: 'desc',
        ownerId: 'u1',
        isTemplate: false,
      }));
      expect(projectRepo.save).toHaveBeenCalled();
      // toResponse(project, 0) 包含 node_count
      expect(result.name).toBe('NewProj');
      expect(result.owner_id).toBe('u1');
      expect(result.node_count).toBe(0);
      // m3: 覆盖 toResponse 的 created_at/updated_at 日期转换逻辑
      expect(result.created_at).toBe('2026-01-01T00:00:00.000Z');
      expect(result.updated_at).toBe('2026-01-02T00:00:00.000Z');
    });
  });

  describe('update', () => {
    it('正常更新项目字段', async () => {
      projectAccess.verifyEditAccess.mockResolvedValue(undefined);
      const project = {
        id: 'p1', name: 'Old', description: 'old', coverUrl: null, ownerId: 'u1',
        createdAt: new Date(), updatedAt: new Date(),
      };
      projectRepo.findOne.mockResolvedValue(project);
      projectRepo.save.mockResolvedValue(undefined);

      const result = await service.update('u1', 'p1', {
        name: 'New', description: 'new', cover_url: '/c',
      });

      // 字段被正确赋值
      expect(project.name).toBe('New');
      expect(project.description).toBe('new');
      expect(project.coverUrl).toBe('/c');
      expect(projectRepo.save).toHaveBeenCalledWith(project);
      // 返回 toResponse
      expect(result.name).toBe('New');
      expect(result.cover_url).toBe('/c');
    });

    it('调用 projectAccess.verifyEditAccess 进行编辑权限校验', async () => {
      projectAccess.verifyEditAccess.mockResolvedValue(undefined);
      projectRepo.findOne.mockResolvedValue({
        id: 'p1', name: 'P', description: '', coverUrl: null, ownerId: 'u1',
        createdAt: new Date(), updatedAt: new Date(),
      });
      projectRepo.save.mockResolvedValue(undefined);

      await service.update('u1', 'p1', { name: 'New' });

      expect(projectAccess.verifyEditAccess).toHaveBeenCalledWith('u1', 'p1');
    });
  });

  describe('delete', () => {
    it('调用 projectAccess.verifyOwner（仅 owner 可删）', async () => {
      projectAccess.verifyOwner.mockResolvedValue(undefined);
      dataSource.transaction.mockImplementation(async (cb) => {
        await cb({ query: jest.fn() });
      });

      await service.delete('u1', 'p1');

      expect(projectAccess.verifyOwner).toHaveBeenCalledWith('u1', 'p1');
    });

    it('事务级联删除（验证 dataSource.transaction 被调用，且执行 6 条 DELETE SQL）', async () => {
      projectAccess.verifyOwner.mockResolvedValue(undefined);
      const managerQuery = jest.fn();
      dataSource.transaction.mockImplementation(async (cb) => {
        await cb({ query: managerQuery });
      });

      await service.delete('u1', 'p1');

      // transaction 被调用一次
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      // manager.query 执行 6 条 DELETE（顺序: edges → nodes → snapshots → render_tasks → media_assets → project）
      expect(managerQuery).toHaveBeenCalledTimes(6);
      expect(managerQuery).toHaveBeenNthCalledWith(1, 'DELETE FROM workflow_edges WHERE project_id = $1', ['p1']);
      expect(managerQuery).toHaveBeenNthCalledWith(2, 'DELETE FROM workflow_nodes WHERE project_id = $1', ['p1']);
      expect(managerQuery).toHaveBeenNthCalledWith(3, 'DELETE FROM project_snapshots WHERE project_id = $1', ['p1']);
      expect(managerQuery).toHaveBeenNthCalledWith(4, 'DELETE FROM render_tasks WHERE project_id = $1', ['p1']);
      expect(managerQuery).toHaveBeenNthCalledWith(5, 'DELETE FROM media_assets WHERE project_id = $1', ['p1']);
      expect(managerQuery).toHaveBeenNthCalledWith(6, 'DELETE FROM projects WHERE id = $1', ['p1']);
    });
  });

  describe('uploadCover', () => {
    // 构造模拟文件对象的辅助函数
    const mockFile = (overrides: any = {}) => ({
      buffer: Buffer.from('img'),
      mimetype: 'image/png',
      size: 1024,
      ...overrides,
    });

    it('调用 projectAccess.verifyEditAccess', async () => {
      projectAccess.verifyEditAccess.mockResolvedValue(undefined);
      projectRepo.findOne.mockResolvedValue({
        id: 'p1', ownerId: 'u1', coverUrl: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      projectRepo.save.mockResolvedValue(undefined);
      minioService.uploadFile.mockResolvedValue(undefined);

      await service.uploadCover('u1', 'p1', mockFile());

      expect(projectAccess.verifyEditAccess).toHaveBeenCalledWith('u1', 'p1');
    });

    it('文件类型非法抛 BadRequestException', async () => {
      projectAccess.verifyEditAccess.mockResolvedValue(undefined);
      projectRepo.findOne.mockResolvedValue({
        id: 'p1', ownerId: 'u1', coverUrl: null,
        createdAt: new Date(), updatedAt: new Date(),
      });

      await expect(
        service.uploadCover('u1', 'p1', mockFile({ mimetype: 'application/pdf' })),
      ).rejects.toThrow(BadRequestException);
      // 类型非法时不应调用上传
      expect(minioService.uploadFile).not.toHaveBeenCalled();
    });

    it('文件大小超限抛 BadRequestException', async () => {
      projectAccess.verifyEditAccess.mockResolvedValue(undefined);
      projectRepo.findOne.mockResolvedValue({
        id: 'p1', ownerId: 'u1', coverUrl: null,
        createdAt: new Date(), updatedAt: new Date(),
      });

      await expect(
        service.uploadCover('u1', 'p1', mockFile({ size: 6 * 1024 * 1024 })),
      ).rejects.toThrow(BadRequestException);
      expect(minioService.uploadFile).not.toHaveBeenCalled();
    });

    it('正常上传（MinioService.uploadFile 被调用，coverUrl 更新）', async () => {
      projectAccess.verifyEditAccess.mockResolvedValue(undefined);
      const project = {
        id: 'p1', ownerId: 'u1', coverUrl: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      projectRepo.findOne.mockResolvedValue(project);
      projectRepo.save.mockResolvedValue(undefined);
      minioService.uploadFile.mockResolvedValue(undefined);

      const result = await service.uploadCover('u1', 'p1', mockFile());

      // 上传到 covers/{pid}.png，使用文件 mimetype
      expect(minioService.uploadFile).toHaveBeenCalledWith(
        'covers/p1.png', Buffer.from('img'), 'image/png',
      );
      // coverUrl 被更新为下载路径
      expect(project.coverUrl).toBe('/api/v1/projects/p1/cover/download');
      expect(projectRepo.save).toHaveBeenCalledWith(project);
      expect(result.cover_url).toBe('/api/v1/projects/p1/cover/download');
    });
  });

  describe('downloadCover', () => {
    it('userId 为空抛 UnauthorizedException', async () => {
      await expect(service.downloadCover('', 'p1')).rejects.toThrow(UnauthorizedException);
      // 未鉴权时不应继续校验权限
      expect(projectAccess.verifyAccess).not.toHaveBeenCalled();
    });

    it('调用 projectAccess.verifyAccess', async () => {
      projectAccess.verifyAccess.mockResolvedValue(undefined);
      minioService.downloadObject.mockResolvedValue(Buffer.from('img'));

      await service.downloadCover('u1', 'p1');

      expect(projectAccess.verifyAccess).toHaveBeenCalledWith('u1', 'p1');
    });

    it('正常下载（返回 buffer + contentType）', async () => {
      projectAccess.verifyAccess.mockResolvedValue(undefined);
      const buf = Buffer.from('img-data');
      minioService.downloadObject.mockResolvedValue(buf);

      const result = await service.downloadCover('u1', 'p1');

      expect(minioService.downloadObject).toHaveBeenCalledWith('covers/p1.png');
      expect(result.buffer).toBe(buf);
      expect(result.contentType).toBe('image/png');
    });
  });
});
