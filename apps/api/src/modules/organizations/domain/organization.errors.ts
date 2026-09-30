import { HttpStatus } from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';

export function organizationNotFoundError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.NOT_FOUND,
    'ORGANIZATION_NOT_FOUND',
    'The organization does not exist.',
  );
}

export function organizationCodeConflictError(): AppHttpException {
  return new AppHttpException(
    HttpStatus.CONFLICT,
    'ORGANIZATION_CODE_EXISTS',
    'An organization with this code already exists.',
  );
}