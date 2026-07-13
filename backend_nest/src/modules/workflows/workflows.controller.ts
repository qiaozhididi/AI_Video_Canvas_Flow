// src/modules/workflows/workflows.controller.ts
import {
  Controller, Get, Post, Delete, Put, Body, Param, UseGuards,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { NodeCreateDto, EdgeCreateDto, WorkflowSaveDto } from './dto/workflow.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private workflowsService: WorkflowsService) {}

  @Get(':id/nodes')
  listNodes(@Param('id') projectId: string) {
    return this.workflowsService.listNodes(projectId);
  }

  @Post(':id/nodes')
  createNode(@Param('id') projectId: string, @Body() dto: NodeCreateDto) {
    return this.workflowsService.createNode(projectId, dto);
  }

  @Delete(':id/nodes/:nodeId')
  async deleteNode(@Param('id') projectId: string, @Param('nodeId') nodeId: string) {
    await this.workflowsService.deleteNode(projectId, nodeId);
    return { detail: '已删除' };
  }

  @Get(':id/edges')
  listEdges(@Param('id') projectId: string) {
    return this.workflowsService.listEdges(projectId);
  }

  @Post(':id/edges')
  createEdge(@Param('id') projectId: string, @Body() dto: EdgeCreateDto) {
    return this.workflowsService.createEdge(projectId, dto);
  }

  @Delete(':id/edges/:edgeId')
  async deleteEdge(@Param('id') projectId: string, @Param('edgeId') edgeId: string) {
    await this.workflowsService.deleteEdge(projectId, edgeId);
    return { detail: '已删除' };
  }

  @Put(':id/save')
  saveWorkflow(@Param('id') projectId: string, @Body() dto: WorkflowSaveDto) {
    return this.workflowsService.saveWorkflow(projectId, dto);
  }
}
