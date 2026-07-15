// src/ws/node-lock.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';

export interface NodeLock {
  nodeId: string;
  projectId: string;
  sid: string;
  userId: string;
  username: string;
  acquiredAt: number;
  expiresAt: number;
  lastRenewed: number;
}

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
