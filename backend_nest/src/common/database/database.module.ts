// src/common/database/database.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('database.url'),
        entities: [__dirname + '/../../modules/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging: config.get<boolean>('project.debug') ? ['error', 'warn'] : ['error'],
        poolSize: 10,
      }),
    }),
  ],
})
export class DatabaseModule {}
