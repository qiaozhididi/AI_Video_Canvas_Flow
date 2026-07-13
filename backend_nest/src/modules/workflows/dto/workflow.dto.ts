// src/modules/workflows/dto/workflow.dto.ts
import { IsString, IsNumber, IsOptional, IsObject } from 'class-validator';

export class NodeCreateDto {
  @IsString() id: string;
  @IsString() node_type: string;
  @IsString() label: string;
  @IsNumber() position_x: number;
  @IsNumber() position_y: number;
  @IsObject() config: any;
}

export class EdgeCreateDto {
  @IsString() id: string;
  @IsString() source_node_id: string;
  @IsString() target_node_id: string;
  @IsString() @IsOptional() source_port?: string;
  @IsString() @IsOptional() target_port?: string;
}

export class WorkflowSaveDto {
  nodes: NodeCreateDto[];
  edges: EdgeCreateDto[];
}
