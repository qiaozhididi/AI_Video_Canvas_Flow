// src/modules/ai/dto/ai.dto.ts
import { IsString, IsOptional, IsBoolean, IsUrl, IsIn } from 'class-validator';

export class ProviderCreateDto {
  @IsString() name: string;
  @IsString() platform: string;
  // M2: base_url 加 URL 校验（require_protocol 防任意字符串如 'javascript:'）
  @IsUrl({ require_protocol: true }, { message: 'base_url 必须是合法 URL（含 http/https 协议）' })
  base_url: string;
  @IsString() api_key: string;
}

export class ProviderUpdateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() platform?: string;
  @IsUrl({ require_protocol: true }, { message: 'base_url 必须是合法 URL（含 http/https 协议）' }) @IsOptional()
  base_url?: string;
  @IsString() @IsOptional() api_key?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

export class ModelCreateDto {
  @IsString() provider_id: string;
  @IsString() model_id: string;
  @IsString() display_name: string;
  // M2: model_type 加白名单校验（对齐 Python Literal['llm','image_gen','video_gen','tts']）
  @IsIn(['llm', 'image_gen', 'video_gen', 'tts'], { message: 'model_type 必须是 llm/image_gen/video_gen/tts 之一' })
  model_type: string;
  @IsBoolean() @IsOptional() is_default?: boolean;
}

export class ModelUpdateDto {
  @IsString() @IsOptional() provider_id?: string;
  @IsString() @IsOptional() model_id?: string;
  @IsString() @IsOptional() display_name?: string;
  @IsIn(['llm', 'image_gen', 'video_gen', 'tts'], { message: 'model_type 必须是 llm/image_gen/video_gen/tts 之一' }) @IsOptional()
  model_type?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsBoolean() @IsOptional() is_default?: boolean;
}

export class GenerateWorkflowDto {
  @IsString() description: string;
  @IsString() @IsOptional() mode?: string;
  @IsString() @IsOptional() model_id?: string;
}

export class GenerateSubtitlesDto {
  @IsString() prompt: string;
  @IsOptional() duration?: number;
  @IsString() @IsOptional() model_id?: string;
}
