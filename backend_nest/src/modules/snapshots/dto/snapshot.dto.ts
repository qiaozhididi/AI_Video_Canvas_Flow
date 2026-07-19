// src/modules/snapshots/dto/snapshot.dto.ts
import { IsString, IsOptional, IsObject } from 'class-validator';

export class SnapshotCreateDto {
  @IsString() source: string;  // auto/manual
  @IsString() @IsOptional() label?: string;
  @IsString() @IsOptional() name?: string;
  @IsObject() snapshot_data: any;
}
