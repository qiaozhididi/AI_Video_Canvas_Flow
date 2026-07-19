// src/modules/workflows/dto/workflow.dto.ts
import { IsString, IsNumber, IsOptional, IsObject, IsArray, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class NodeCreateDto {
  // M2: id 加长度限制（对齐 workflow_nodes.id varchar(128)），防超长字符串破坏 FK
  @IsString() @MaxLength(128) id: string;
  @IsString() @MaxLength(64) node_type: string;
  @IsString() @MaxLength(128) label: string;
  @IsNumber() position_x: number;
  @IsNumber() position_y: number;
  @IsObject() config: any;
}

export class EdgeCreateDto {
  @IsString() @MaxLength(128) id: string;
  @IsString() @MaxLength(128) source_node_id: string;
  @IsString() @MaxLength(128) target_node_id: string;
  @IsString() @IsOptional() source_port?: string;
  @IsString() @IsOptional() target_port?: string;
}

export class WorkflowSaveDto {
  // M2: @ValidateNested({ each: true }) + @Type 让嵌套对象的字段也被校验
  // （原仅 @IsArray，whitelist:true 不会深入嵌套对象，可注入任意 id 字符串破坏 FK 与后续查询）
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeCreateDto)
  nodes: NodeCreateDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeCreateDto)
  edges: EdgeCreateDto[];
}
