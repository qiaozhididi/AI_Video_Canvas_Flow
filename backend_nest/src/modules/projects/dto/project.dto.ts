// src/modules/projects/dto/project.dto.ts
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class ProjectCreateDto {
  @IsString() name: string;
  @IsString() @IsOptional() description?: string;
}

export class ProjectUpdateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() cover_url?: string;
}
