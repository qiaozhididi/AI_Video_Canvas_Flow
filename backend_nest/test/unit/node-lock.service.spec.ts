import { Test, TestingModule } from '@nestjs/testing';
import { NodeLockService } from '../../src/ws/node-lock.service';

describe('NodeLockService', () => {
  let service: NodeLockService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [NodeLockService],
    }).compile();
    service = moduleRef.get<NodeLockService>(NodeLockService);
  });

  // NodeLockService.onModuleInit 会启动 setInterval，需关闭模块以清理定时器
  afterEach(async () => {
    if (moduleRef) await moduleRef.close();
  });

  describe('acquireLock', () => {
    it('应成功获取锁', () => {
      const lock = service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      expect(lock).not.toBeNull();
      expect(lock!.nodeId).toBe('node-1');
      expect(lock!.sid).toBe('sid-1');
    });

    it('同一节点第二次获取锁应失败 (不同 sid)', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const lock = service.acquireLock('proj-1', 'node-1', 'sid-2', 'user-2', 'bob');
      expect(lock).toBeNull();
    });

    it('同一 sid 可重新获取已持有的锁', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const lock = service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      expect(lock).not.toBeNull();
    });
  });

  describe('renew', () => {
    it('续租已持有的锁应成功', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const lock = service.renew('proj-1', 'node-1', 'sid-1');
      expect(lock).not.toBeNull();
    });

    it('续租他人持有的锁应失败', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const lock = service.renew('proj-1', 'node-1', 'sid-2');
      expect(lock).toBeNull();
    });
  });

  describe('release', () => {
    it('释放已持有的锁应成功', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const result = service.release('proj-1', 'node-1', 'sid-1');
      expect(result).toBe(true);
      const lock = service.acquireLock('proj-1', 'node-1', 'sid-2', 'user-2', 'bob');
      expect(lock).not.toBeNull();
    });
  });

  describe('forceRelease', () => {
    it('强制释放锁 (owner)', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const result = service.forceRelease('proj-1', 'node-1');
      expect(result).toBe(true);
    });
  });

  describe('purgeSidLocks', () => {
    it('清理某 sid 的所有锁 (断线)', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      service.acquireLock('proj-1', 'node-2', 'sid-1', 'user-1', 'alice');
      service.acquireLock('proj-1', 'node-3', 'sid-2', 'user-2', 'bob');

      const removed = service.purgeSidLocks('sid-1');
      expect(removed.length).toBe(2);

      const locks = service.getActiveLocks('proj-1');
      expect(locks.length).toBe(1);
      expect(locks[0].sid).toBe('sid-2');
    });
  });

  describe('popLock', () => {
    it('删除节点时 pop 锁', () => {
      service.acquireLock('proj-1', 'node-1', 'sid-1', 'user-1', 'alice');
      const lock = service.popLock('proj-1', 'node-1');
      expect(lock).not.toBeNull();
      expect(lock!.nodeId).toBe('node-1');
    });
  });
});
