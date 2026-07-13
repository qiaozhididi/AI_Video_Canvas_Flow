// src/common/auth/optional-token.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalTokenGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const tokenQuery = request.query.token;

    // 无 token 时放行 (request.user 为 undefined)
    if (!authHeader && !tokenQuery) return true;

    // 有 query token 时注入到 header
    if (!authHeader && tokenQuery) {
      request.headers.authorization = `Bearer ${tokenQuery}`;
    }

    try {
      await super.canActivate(context);
    } catch {
      // token 无效时放行 (request.user 为 undefined)
    }
    return true;
  }

  handleRequest(err: any, user: any) {
    return user; // 始终返回 user (可能为 undefined)
  }
}
