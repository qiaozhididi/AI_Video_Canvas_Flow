// src/modules/collaboration/collaboration.controller.ts
import { Controller, Get } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';

@Controller()
export class CollaborationController {
  constructor(private collaborationService: CollaborationService) {}

  @Get('status')
  getStatus() {
    return this.collaborationService.getStatus();
  }
}
