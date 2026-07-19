// src/modules/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiProvider } from './entities/ai-provider.entity';
import { AiModel } from './entities/ai-model.entity';
import { MediaAsset } from '../media/entities/media-asset.entity';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../../common/auth/auth.module';  // 提供 MinioService

@Module({
  imports: [TypeOrmModule.forFeature([AiProvider, AiModel, MediaAsset]), AuthModule],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
