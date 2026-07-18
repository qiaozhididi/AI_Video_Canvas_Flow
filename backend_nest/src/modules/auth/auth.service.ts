// src/modules/auth/auth.service.ts
import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { User } from './entities/user.entity';
import { RegisterDto, LoginDto, UserUpdateDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // 检查用户名唯一
    const existUsername = await this.userRepo.findOne({ where: { username: dto.username } });
    if (existUsername) throw new BadRequestException('用户名已存在');

    // 检查邮箱唯一
    const existEmail = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existEmail) throw new BadRequestException('邮箱已被注册');

    // 创建用户 (bcryptjs 兼容 Python bcrypt)
    const hashedPassword = bcrypt.hashSync(dto.password, bcrypt.genSaltSync());
    const user = this.userRepo.create({
      id: uuidv4(),
      username: dto.username,
      email: dto.email,
      hashedPassword,
    });
    await this.userRepo.save(user);

    return this.toResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { username: dto.username } });
    if (!user || !bcrypt.compareSync(dto.password, user.hashedPassword)) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const userId = user.id;
    const access_token = this.createToken(userId, this.config.get<number>('jwt.expiresIn')!);
    const refresh_token = this.createToken(userId, this.config.get<number>('jwt.refreshExpiresIn')!);

    return { access_token, refresh_token, token_type: 'bearer' };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get<string>('jwt.secret'),
      });
      const userId = payload.sub;
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new UnauthorizedException('用户不存在');

      const access_token = this.createToken(userId, this.config.get<number>('jwt.expiresIn')!);
      const new_refresh = this.createToken(userId, this.config.get<number>('jwt.refreshExpiresIn')!);
      return { access_token, refresh_token: new_refresh, token_type: 'bearer' };
    } catch {
      throw new UnauthorizedException('refresh token 已过期');
    }
  }

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return this.toResponse(user);
  }

  async updateMe(userId: string, dto: UserUpdateDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');

    if (dto.username && dto.username !== user.username) {
      const exist = await this.userRepo.findOne({ where: { username: dto.username } });
      if (exist) throw new BadRequestException('用户名已存在');
      user.username = dto.username;
    }

    if (dto.email && dto.email !== user.email) {
      const exist = await this.userRepo.findOne({ where: { email: dto.email } });
      if (exist) throw new BadRequestException('邮箱已被注册');
      user.email = dto.email;
    }

    if (dto.avatar_url !== undefined) {
      user.avatarUrl = dto.avatar_url;
    }

    await this.userRepo.save(user);
    return this.toResponse(user);
  }

  private createToken(userId: string, expiresSeconds: number): string {
    return this.jwtService.sign(
      { sub: userId },
      { expiresIn: expiresSeconds, algorithm: 'HS256' },
    );
  }

  private toResponse(user: User) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatarUrl,
    };
  }
}
