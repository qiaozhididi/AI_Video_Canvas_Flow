// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './common/auth/auth.module';
import { AuthBusinessModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    AuthBusinessModule,
    ProjectsModule,
  ],
})
export class AppModule {}
