// src/modules/ai/dto/ai.dto.ts
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class ProviderCreateDto {
  @IsString() name: string;
  @IsString() platform: string;
  @IsString() base_url: string;
  @IsString() api_key: string;
}

export class ProviderUpdateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() base_url?: string;
  @IsString() @IsOptional() api_key?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

export class ModelCreateDto {
  @IsString() provider_id: string;
  @IsString() model_id: string;
  @IsString() display_name: string;
  @IsString() model_type: string;  // llm/image_gen/video_gen/tts
  @IsBoolean() @IsOptional() is_default?: boolean;
}

export class ModelUpdateDto {
  @IsString() @IsOptional() display_name?: string;
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
  @IsString() @IsOptional() model_id?: string;
}
