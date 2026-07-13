// src/modules/templates/dto/template.dto.ts
import { IsString, IsOptional, IsArray } from 'class-validator';

export class TemplatePublishDto {
  @IsString() category: string;
  @IsArray() @IsOptional() tags?: string[];
}
