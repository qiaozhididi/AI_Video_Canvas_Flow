import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto, UpdateCollaboratorRoleDto } from './dto/invitation.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class InvitationsController {
  constructor(private invitationsService: InvitationsService) {}

  // 创建邀请（owner only）
  @Post('projects/:id/invitations')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  createInvitation(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(userId, projectId, dto);
  }

  // 查看邀请信息（无需登录，前端 AcceptInvite 页面在登录前调用）
  @Get('invitations/:token')
  getInvitation(@Param('token') token: string) {
    return this.invitationsService.getInvitation(token);
  }

  // 接受邀请
  @Post('invitations/:token/accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  acceptInvitation(@CurrentUser() userId: string, @Param('token') token: string) {
    return this.invitationsService.acceptInvitation(token, userId);
  }

  // 列出协作者
  @Get('projects/:id/collaborators')
  @UseGuards(JwtAuthGuard)
  listCollaborators(@CurrentUser() userId: string, @Param('id') projectId: string) {
    return this.invitationsService.listCollaborators(userId, projectId);
  }

  // 修改协作者权限
  @Put('projects/:id/collaborators/:userId')
  @UseGuards(JwtAuthGuard)
  updateCollaboratorRole(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateCollaboratorRoleDto,
  ) {
    return this.invitationsService.updateCollaboratorRole(userId, projectId, targetUserId, dto.role);
  }

  // 移除协作者
  @Delete('projects/:id/collaborators/:userId')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async removeCollaborator(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.invitationsService.removeCollaborator(userId, projectId, targetUserId);
  }
}
