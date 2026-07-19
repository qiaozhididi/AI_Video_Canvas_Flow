import { IsOptional, IsInt, IsIn, Min, Max } from 'class-validator';

export class CreateInvitationDto {
  @IsIn(['editor', 'viewer']) role: string;
  @IsInt() @IsOptional() @Min(1) @Max(8760) expires_in_hours?: number | null;
}

export class UpdateCollaboratorRoleDto {
  @IsIn(['editor', 'viewer']) role: string;
}
