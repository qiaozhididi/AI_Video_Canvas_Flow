// src/modules/auth/auth.controller.ts
import { Controller, Post, Get, Put, Body, UseGuards, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto, UserUpdateDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(200)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() userId: string) {
    return this.authService.getMe(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('me')
  updateMe(@CurrentUser() userId: string, @Body() dto: UserUpdateDto) {
    return this.authService.updateMe(userId, dto);
  }
}
