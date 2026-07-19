// src/common/interceptors/logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger, HttpException } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    // M8: URL 脱敏，避免日志记录敏感 token（邀请 token 路径参数 + 媒体下载 query token）
    const safeUrl = this.sanitizeUrl(url);
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        this.logger.log(`${method} ${safeUrl} ${response.statusCode} - ${Date.now() - now}ms`);
      }),
      // O2: 错误请求也记录（tap 只在成功时触发，错误走 catchError）
      catchError((error) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        const msg = `${method} ${safeUrl} ${status} - ${Date.now() - now}ms - ${error.message}`;
        if (status >= 500) {
          this.logger.error(msg, error.stack);
        } else {
          this.logger.warn(msg);
        }
        return throwError(() => error);
      }),
    );
  }

  /**
   * M8: URL 脱敏
   * - 邀请 token 路径参数：/api/v1/invitations/{token} → /api/v1/invitations/***
   *   （getInvitation 无需登录即可调用，token 泄露可让攻击者接受邀请加入他人项目）
   * - 媒体下载 query token：?token=xxx → ?token=*** （img/video 标签用的预签名 token）
   */
  private sanitizeUrl(url: string): string {
    return url
      .replace(/([?&])token=[^&]*/gi, '$1token=***')
      .replace(/\/invitations\/[^/?]+/i, '/invitations/***');
  }
}
