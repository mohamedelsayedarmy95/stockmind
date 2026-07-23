import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';

const STATUS_TO_KEY: Record<number, string> = {
  [HttpStatus.UNAUTHORIZED]: 'common.error.unauthorized',
  [HttpStatus.FORBIDDEN]: 'common.error.forbidden',
  [HttpStatus.NOT_FOUND]: 'common.error.not_found',
  [HttpStatus.CONFLICT]: 'common.error.conflict',
  [HttpStatus.BAD_REQUEST]: 'common.error.bad_request',
  [HttpStatus.TOO_MANY_REQUESTS]: 'common.error.too_many_requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'common.error.internal',
};

// Generic phrases emitted by NestJS/PassportJS that we replace with i18n translations.
const GENERIC_PHRASES = new Set([
  'internal server error',
  'unauthorized',
  'forbidden',
  'not found',
  'conflict',
  'bad request',
  'too many requests',
]);

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const lang = this.resolveLang(request);

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = this.tr('common.error.internal', lang);

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      const bodyMessage =
        typeof body === 'string'
          ? body
          : (body as Record<string, unknown>).message as string | string[];

      const i18nKey = STATUS_TO_KEY[statusCode];
      const isGeneric =
        typeof bodyMessage === 'string' &&
        GENERIC_PHRASES.has(bodyMessage.toLowerCase());

      message = i18nKey && isGeneric ? this.tr(i18nKey, lang) : bodyMessage;
    }

    response.status(statusCode).json({
      statusCode,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  private resolveLang(request: Request): string {
    const header = request.headers['accept-language'];
    if (!header) return 'en';
    const primary = (header.split(',')[0] ?? 'en').split(';')[0].trim();
    return primary.startsWith('ar') ? 'ar' : 'en';
  }

  private tr(key: string, lang: string): string {
    try {
      return this.i18n.translate(key, { lang }) as string;
    } catch {
      return key;
    }
  }
}
