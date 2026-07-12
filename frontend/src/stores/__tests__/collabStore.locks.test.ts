import { describe, it, expect, beforeEach } from 'vitest';
import type { Socket } from 'socket.io-client';
import { useCollabStore } from '../collabStore';

describe('collabStore 锁状态', () => {
  beforeEach(() => {
    useCollabStore.setState({ nodeLocks: {}, myLocks: {} });
  });

  describe('isNodeLocked', () => {
    it('节点在 nodeLocks 中时返回 true', () => {
      useCollabStore.setState({
        nodeLocks: {
          n1: { node_id: 'n1', project_id: 'p1', sid: 'other', user_id: 'u2', username: 'A', acquired_at: 0, expires_at: 999 },
        },
      });
      expect(useCollabStore.getState().isNodeLocked('n1')).toBe(true);
    });

    it('节点不在 nodeLocks 中时返回 false', () => {
      expect(useCollabStore.getState().isNodeLocked('n2')).toBe(false);
    });
  });

  describe('isNodeLockedByMe', () => {
    it('节点在 myLocks 中时返回 true', () => {
      useCollabStore.setState({
        myLocks: {
          n1: { node_id: 'n1', project_id: 'p1', sid: 'me', user_id: 'u1', username: 'me', acquired_at: 0, expires_at: 999 },
        },
      });
      expect(useCollabStore.getState().isNodeLockedByMe('n1')).toBe(true);
    });

    it('节点仅在 nodeLocks（他人锁）时返回 false', () => {
      useCollabStore.setState({
        nodeLocks: {
          n2: { node_id: 'n2', project_id: 'p1', sid: 'other', user_id: 'u2', username: 'A', acquired_at: 0, expires_at: 999 },
        },
      });
      expect(useCollabStore.getState().isNodeLockedByMe('n2')).toBe(false);
    });
  });

  describe('getNodeLockHolder', () => {
    it('返回持锁者信息', () => {
      const lock = { node_id: 'n1', project_id: 'p1', sid: 's1', user_id: 'u1', username: 'alice', acquired_at: 0, expires_at: 999 };
      useCollabStore.setState({ nodeLocks: { n1: lock } });
      expect(useCollabStore.getState().getNodeLockHolder('n1')).toEqual(lock);
    });

    it('无锁时返回 null', () => {
      expect(useCollabStore.getState().getNodeLockHolder('unknown')).toBeNull();
    });
  });

  describe('renewLock', () => {
    // 捕获 renew_lock 的 ack 回调，便于在测试中模拟后端响应
    let renewAckCb: ((ack: { ok: boolean; expires_at?: number }) => void) | null;
    let mockSocket: { emit: (event: string, data: unknown, cb: (ack: { ok: boolean; expires_at?: number }) => void) => void };

    beforeEach(() => {
      renewAckCb = null;
      mockSocket = {
        emit: (_event, _data, cb) => {
          renewAckCb = cb;
        },
      };
    });

    it('续租失败（ack.ok=false）时清理 myLocks 和 nodeLocks', async () => {
      const lock = { node_id: 'n1', project_id: 'p1', sid: 'me', user_id: 'u1', username: 'me', acquired_at: 0, expires_at: 100 };
      useCollabStore.setState({
        socket: mockSocket as unknown as Socket,
        currentProjectId: 'p1',
        myLocks: { n1: lock },
        nodeLocks: { n1: lock },
      });

      const promise = useCollabStore.getState().renewLock('n1');
      // 模拟后端返回 ok: false（锁已丢失）
      renewAckCb!({ ok: false });
      const result = await promise;

      expect(result).toBe(false);
      expect(useCollabStore.getState().myLocks['n1']).toBeUndefined();
      expect(useCollabStore.getState().nodeLocks['n1']).toBeUndefined();
      expect(useCollabStore.getState().isNodeLockedByMe('n1')).toBe(false);
      expect(useCollabStore.getState().isNodeLocked('n1')).toBe(false);
    });

    it('续租成功时更新 expires_at 并保留 myLocks', async () => {
      const lock = { node_id: 'n1', project_id: 'p1', sid: 'me', user_id: 'u1', username: 'me', acquired_at: 0, expires_at: 100 };
      useCollabStore.setState({
        socket: mockSocket as unknown as Socket,
        currentProjectId: 'p1',
        myLocks: { n1: lock },
        nodeLocks: { n1: lock },
      });

      const promise = useCollabStore.getState().renewLock('n1');
      renewAckCb!({ ok: true, expires_at: 200 });
      const result = await promise;

      expect(result).toBe(true);
      expect(useCollabStore.getState().myLocks['n1'].expires_at).toBe(200);
      expect(useCollabStore.getState().isNodeLockedByMe('n1')).toBe(true);
    });

    it('无锁时不发起请求', async () => {
      const result = await useCollabStore.getState().renewLock('n1');
      expect(result).toBe(false);
      expect(renewAckCb).toBeNull();
    });
  });
});
