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
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        this.logger.log(`${method} ${url} ${response.statusCode} - ${Date.now() - now}ms`);
      }),
      // O2: 错误请求也记录（tap 只在成功时触发，错误走 catchError）
      catchError((error) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        const msg = `${method} ${url} ${status} - ${Date.now() - now}ms - ${error.message}`;
        if (status >= 500) {
          this.logger.error(msg, error.stack);
        } else {
          this.logger.warn(msg);
        }
        return throwError(() => error);
      }),
    );
  }
}
