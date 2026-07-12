import { describe, it, expect, beforeEach } from 'vitest';
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
});
