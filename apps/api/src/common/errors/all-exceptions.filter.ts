import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    requestId: string;
  };
}

function safeMessage(message: string): string {
  return message.length <= 512 ? message : `${message.slice(0, 512)}...`;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.requestId ?? request.header('x-request-id') ?? '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = STATUS_CODE_MAP[HttpStatus.INTERNAL_SERVER_ERROR] ?? 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body !== null && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record['message'] === 'string') {
          message = record['message'];
        } else if (Array.isArray(record['message'])) {
          message = (record['message'] as string[]).map(String).join('; ');
        }
        if (typeof record['code'] === 'string') {
          code = record['code'];
        }
        if (record['details'] !== null && typeof record['details'] === 'object') {
          details = record['details'] as Record<string, unknown>;
        }
      }
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        message = 'Internal server error';
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Request ${requestId} failed: ${safeMessage(message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const resolvedCode = code !== STATUS_CODE_MAP[HttpStatus.INTERNAL_SERVER_ERROR]
      ? code
      : STATUS_CODE_MAP[status] ?? code;
    const envelope: ErrorEnvelope = {
      error: {
        code: resolvedCode,
        message: safeMessage(message),
        details,
        requestId,
      },
    };
    response.status(status).json(envelope);
  }
}
