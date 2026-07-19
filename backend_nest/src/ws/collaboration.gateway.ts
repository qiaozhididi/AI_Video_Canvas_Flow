// src/ws/collaboration.gateway.ts
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
  MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { NodeLockService } from './node-lock.service';
import { InvitationsService } from '../modules/invitations/invitations.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../modules/auth/entities/user.entity';

@WebSocketGateway({
  namespace: '/',
  cors: { origin: true, credentials: true },
  transports: ['websocket'],
})
export class CollaborationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('CollaborationGateway');

  private roomMembers: Map<string, Map<string, { userId: string; username: string }>> = new Map();

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

  afterInit(server: Server) {
    // 鉴权中间件：在连接建立前完成 JWT 校验并填充 socket.data，避免 handleConnection 的 async 竞态
    // （前端 connect 后立即 emit join_project，可能早于 handleConnection 的 await userRepo.findOne 完成，
    // 导致 client.data.userId 为 undefined，user_joined/ack 广播 user_id: undefined）
    server.use(async (socket: Socket, next: (err?: Error) => void) => {
      try {
        const token = socket.handshake.query.token as string;
        if (!token) {
          return next(new Error('未授权：缺少 token'));
        }
        const payload = this.jwtService.verify(token, {
          secret: this.config.get<string>('jwt.secret'),
        });
        const userId = payload.sub;
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
          return next(new Error('用户不存在'));
        }
        socket.data.userId = userId;
        socket.data.username = user.username;
        this.logger.log(`[WS:Connect] sid=${socket.id} user=${user.username}`);
        next();
      } catch (err) {
        this.logger.warn(`[WS:Connect] 鉴权失败: ${(err as Error).message}`);
        next(err as Error);
      }
    });
  }

  async handleConnection(client: Socket) {
    // 鉴权已在 afterInit 中间件完成，socket.data.userId/username 已就绪
    this.logger.log(`[WS:HandleConnection] sid=${client.id} user=${client.data.username}`);
  }

  async handleDisconnect(client: Socket) {
    const { userId, username } = client.data;
    this.logger.log(`[WS:Disconnect] sid=${client.id} user=${username || 'unknown'}`);

    const removedLocks = this.nodeLockService.purgeSidLocks(client.id);
    for (const lock of removedLocks) {
      this.broadcastLockChanged(lock.projectId, lock.nodeId, null);
    }

    for (const [projectId, members] of this.roomMembers) {
      if (members.has(client.id)) {
        members.delete(client.id);
        if (members.size === 0) {
          this.roomMembers.delete(projectId);
        }
        this.server.to(`project:${projectId}`).emit('user_left', {
          sid: client.id,
          user_id: userId,
          username,
        });
      }
    }
  }

  @SubscribeMessage('join_project')
  async handleJoinProject(@ConnectedSocket() client: Socket, @MessageBody() payload: { project_id: string }) {
    const { userId, username } = client.data;
    const projectId = payload.project_id;
    const room = `project:${projectId}`;

    // B4: 协作房间 10 用户上限（硬约束）— 仅对新成员检查，已在房间的重复 join 不阻止
    const currentMembers = this.roomMembers.get(projectId);
    if (currentMembers && !currentMembers.has(client.id) && currentMembers.size >= 10) {
      this.logger.warn(`[WS:JoinProject] 房间已满 project=${projectId} user=${username}`);
      return { error: 'room_full', message: '协作房间已满（10 人）' };
    }

    client.join(room);

    if (!this.roomMembers.has(projectId)) {
      this.roomMembers.set(projectId, new Map());
    }
    this.roomMembers.get(projectId)!.set(client.id, { userId, username });

    const members = this.roomMembers.get(projectId)!;
    const users = Array.from(members.entries()).map(([sid, info]) => ({
      sid,
      user_id: info.userId,
      username: info.username,
    }));
    const locks = this.nodeLockService.getActiveLocks(projectId).map(l => this.nodeLockService.lockToDict(l));

    client.to(room).emit('user_joined', { sid: client.id, user_id: userId, username });

    this.logger.log(`[WS:JoinProject] sid=${client.id} project=${projectId} user=${username}`);

    return { users, locks };
  }

  @SubscribeMessage('leave_project')
  async handleLeaveProject(@ConnectedSocket() client: Socket, @MessageBody() payload: { project_id: string }) {
    const projectId = payload.project_id;
    const room = `project:${projectId}`;
    client.leave(room);

    const members = this.roomMembers.get(projectId);
    if (members) {
      members.delete(client.id);
      if (members.size === 0) {
        this.roomMembers.delete(projectId);
      }
      client.to(room).emit('user_left', {
        sid: client.id,
        user_id: client.data.userId,
        username: client.data.username,
      });
    }
    return { ok: true };
  }

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

  @SubscribeMessage('cursor_move')
  async handleCursorMove(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    const { userId, username } = client.data;
    const { project_id } = payload;
    const room = `project:${project_id}`;
    client.to(room).emit('cursor_move', { ...payload, sid: client.id, user_id: userId, username });
  }

  @SubscribeMessage('acquire_lock')
  async handleAcquireLock(@ConnectedSocket() client: Socket, @MessageBody() payload: { project_id: string; node_id: string }) {
    const { userId, username } = client.data;
    const { project_id, node_id } = payload;

    const { canEdit } = await this.invitationsService.checkEditPermission(userId, project_id);
    if (!canEdit) {
      return { ok: false, reason: 'permission_denied' };
    }

    const lock = this.nodeLockService.acquireLock(project_id, node_id, client.id, userId, username);
    if (!lock) {
      const holder = this.nodeLockService.getLock(project_id, node_id);
      if (holder) {
        return { ok: false, reason: 'locked_by_other', holder: this.nodeLockService.lockToDict(holder) };
      }
      return { ok: false, reason: 'error', message: '节点已被锁定' };
    }

    this.broadcastLockChanged(project_id, node_id, this.nodeLockService.lockToDict(lock));
    return { ok: true, lock: this.nodeLockService.lockToDict(lock) };
  }

  @SubscribeMessage('renew_lock')
  async handleRenewLock(@ConnectedSocket() client: Socket, @MessageBody() payload: { project_id: string; node_id: string }) {
    const { project_id, node_id } = payload;
    const lock = this.nodeLockService.renew(project_id, node_id, client.id);
    if (!lock) {
      return { ok: false };
    }
    return { ok: true, expires_at: lock.expiresAt };
  }

  @SubscribeMessage('release_lock')
  async handleReleaseLock(@ConnectedSocket() client: Socket, @MessageBody() payload: { project_id: string; node_id: string }) {
    const { project_id, node_id } = payload;
    const released = this.nodeLockService.release(project_id, node_id, client.id);
    if (released) {
      this.broadcastLockChanged(project_id, node_id, null);
    }
    return { ok: released };
  }

  @SubscribeMessage('force_release')
  async handleForceRelease(@ConnectedSocket() client: Socket, @MessageBody() payload: { project_id: string; node_id: string }) {
    const { userId } = client.data;
    const { project_id, node_id } = payload;

    const { isOwner } = await this.invitationsService.checkEditPermission(userId, project_id);
    if (!isOwner) {
      return { ok: false, error: '无权强制释放' };
    }

    const released = this.nodeLockService.forceRelease(project_id, node_id);
    if (released) {
      this.broadcastLockChanged(project_id, node_id, null);
    }
    return { ok: released };
  }

  @SubscribeMessage('ping')
  async handlePing(@ConnectedSocket() client: Socket) {
    return { pong: Date.now() };
  }

  private broadcastLockChanged(projectId: string, nodeId: string, lock: any) {
    const room = `project:${projectId}`;
    this.server.to(room).emit('lock_changed', { project_id: projectId, node_id: nodeId, lock });
  }
}
