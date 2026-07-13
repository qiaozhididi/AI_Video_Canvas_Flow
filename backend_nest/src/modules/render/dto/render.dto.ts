// src/modules/render/dto/render.dto.ts
import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';

export class RenderTaskCreateDto {
  @IsString() project_id: string;
  @IsString() task_type: string;  // render/ai_text2img/ai_img2img/ai_text2video/ai_img2video/ai_tts
  @IsString() @IsOptional() model_id?: string;
  @IsString() @IsOptional() prompt?: string;
  @IsString() @IsOptional() node_id?: string;
  @IsArray() @IsOptional() input_artifacts?: any[];
  @IsObject() @IsOptional() node_params?: any;
}

export class ExportRequestDto {
  @IsString() project_id: string;
  @IsString() format: string;  // mp4/mov/webm
  @IsString() resolution: string;  // 720p/1080p/4k
  @IsArray() subtitles: any[];  // [{start, end, text}]
}
