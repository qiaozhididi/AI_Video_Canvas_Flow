// src/common/filters/fastapi-compat.filter.ts
import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class FastApiCompatFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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
    } else {
      this.logger.error(`未处理异常: ${exception}`, (exception as Error)?.stack);
    }

    this.logger.debug(`${request.method} ${request.url} → ${status} ${message}`);

    response.status(status).json({ detail: message });
  }
}
