export const REQUEST_ACTIONS = {
  CREATE: 'request.created',
  UPDATE: 'request.updated',
  SUBMIT: 'request.submitted',
  APPROVE: 'request.approved',
  REJECT: 'request.rejected',
  CANCEL: 'request.cancelled',
  EXPIRE: 'request.expired',
} as const;

export const REQUEST_PUBLIC_CODE_PREFIX = 'REQ';
