import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function forbiddenError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.FORBIDDEN,
    'FORBIDDEN',
    'You do not have permission to perform this action.',
  );
}

export function permissionContextMissingError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'PERMISSION_CONTEXT_MISSING',
    'The permission requirement is missing its resource context.',
  );
}