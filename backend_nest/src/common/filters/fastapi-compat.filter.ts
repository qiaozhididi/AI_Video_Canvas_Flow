// src/common/filters/fastapi-compat.filter.ts
import { Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class FastApiCompatFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = 500;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      // HttpException response 可能是字符串或对象
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as any;
        message = Array.isArray(resObj.message) ? resObj.message[0] : (resObj.message || exception.message);
      }
    }

    // M1: 日志记录由 LoggingInterceptor 的 catchError 统一处理（含 duration + status + stack）
    //   ExceptionFilter 专注响应转换，避免错误请求双重日志
    response.status(status).json({ detail: message });
  }
}
