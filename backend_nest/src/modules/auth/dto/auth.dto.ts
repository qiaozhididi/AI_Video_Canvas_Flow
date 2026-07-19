// src/modules/auth/dto/auth.dto.ts
import { IsString, IsEmail, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

export class RegisterDto {
  // M2: username 加格式校验（对齐 Python auth.py），仅允许字母/数字/下划线/短横线，3-32 字符
  @IsString() @Matches(/^[a-zA-Z0-9_-]{3,32}$/, { message: '用户名仅允许字母、数字、下划线、短横线，长度 3-32' })
  username: string;
  @IsEmail() email: string;
  // M2: password 加长度限制（对齐 Python auth.py），防弱密码与超长输入
  @IsString() @MinLength(8, { message: '密码至少 8 位' }) @MaxLength(128, { message: '密码不能超过 128 位' })
  password: string;
}

export class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
}

export class RefreshDto {
  @IsString() refresh_token: string;
}

export class UserUpdateDto {
  @IsString() @IsOptional() username?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() avatar_url?: string;
}