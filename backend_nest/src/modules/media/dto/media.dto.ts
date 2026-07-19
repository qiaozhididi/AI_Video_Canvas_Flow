// src/modules/media/dto/media.dto.ts
import { IsString, IsOptional } from 'class-validator';

export class MediaUploadDto {
  @IsString() @IsOptional() project_id?: string;
}
