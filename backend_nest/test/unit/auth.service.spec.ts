import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../src/modules/auth/auth.service';
import { User } from '../../src/modules/auth/entities/user.entity';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: any;
  let jwtService: any;
  let configService: any;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('mock-token'),
      verify: jest.fn(),
    };
    configService = {
      get: jest.fn((key) => {
        const config: any = {
          'jwt.expiresIn': 1800,
          'jwt.refreshExpiresIn': 604800,
          'jwt.secret': 'test-secret',
        };
        return config[key];
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = moduleRef.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('应成功注册新用户', async () => {
      // register 会调用两次 findOne: 用户名检查 + 邮箱检查，都返回 null
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.username).toBe('testuser');
      expect(result.email).toBe('test@example.com');
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('用户名已存在时应抛出 ConflictException', async () => {
      // 第一次 findOne (用户名检查) 返回已有用户
      userRepo.findOne.mockResolvedValueOnce({ id: 'existing', username: 'testuser' });

      await expect(service.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      })).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('应成功登录并返回 token', async () => {
      const hashedPassword = bcrypt.hashSync('password123', bcrypt.genSaltSync());
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        hashedPassword,
      });

      const result = await service.login({
        username: 'testuser',
        password: 'password123',
      });

      expect(result.access_token).toBe('mock-token');
      expect(result.refresh_token).toBe('mock-token');
      expect(result.token_type).toBe('bearer');
    });

    it('密码错误时应抛出 UnauthorizedException', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        username: 'testuser',
        hashedPassword: bcrypt.hashSync('correct-password', bcrypt.genSaltSync()),
      });

      await expect(service.login({
        username: 'testuser',
        password: 'wrong-password',
      })).rejects.toThrow();
    });
  });
});
