import { HttpException, HttpStatus } from '@nestjs/common';

interface StructuredError {
  message: string;
  code: string;
  details: Record<string, unknown>;
}

export class AppHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    const body: StructuredError = { message, code, details };
    super(body, status);
  }
}