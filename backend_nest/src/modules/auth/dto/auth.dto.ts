// src/modules/auth/dto/auth.dto.ts
import { IsString, IsEmail, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsString() username: string;
  @IsEmail() email: string;
  @IsString() password: string;
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
