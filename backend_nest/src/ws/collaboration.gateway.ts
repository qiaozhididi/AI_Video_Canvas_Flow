// src/ws/collaboration.gateway.ts
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect,
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
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
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
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.query.token as string;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      const userId = payload.sub;

      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        client.disconnect();
        return;
      }

      client.data.userId = userId;
      client.data.username = user.username;
      this.logger.log(`[WS:Connect] sid=${client.id} user=${user.username}`);
    } catch (err) {
      this.logger.warn(`[WS:Connect] 鉴权失败: ${(err as Error).message}`);
      client.disconnect();
    }
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
