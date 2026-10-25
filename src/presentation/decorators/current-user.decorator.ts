import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  sub: string;
  companyId: string;
  role: string;
  /** The member's token_version as of this request (set by JwtStrategy from the database). */
  tv?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtPayload;
  },
);
