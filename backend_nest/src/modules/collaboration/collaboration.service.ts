// src/modules/collaboration/collaboration.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class CollaborationService {
  getStatus() {
    return {
      status: 'ok',
      transport: 'socket.io',
    };
  }
}
