// src/modules/render/dto/render.dto.ts
import { IsString, IsOptional, IsArray, IsObject, IsIn } from 'class-validator';

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
  // M3: 加默认值与白名单校验（对齐 Python render.py:250-254 默认 format='mp4', resolution='1080p', subtitles=[]）
  // 原仅 @IsString 必填，前端不传时直接 400；与 Python 行为不一致
  @IsIn(['mp4', 'mov', 'webm']) format: string = 'mp4';
  @IsIn(['720p', '1080p', '4k']) resolution: string = '1080p';
  @IsArray() subtitles: any[] = [];  // [{start, end, text}]
}
