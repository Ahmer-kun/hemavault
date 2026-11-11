export const TRANSFER_PUBLIC_CODE_PREFIX = 'TRF';

export const TRANSFER_ACTIONS = {
  CREATE: 'transfer.created',
  APPROVE: 'transfer.approved',
  REJECT: 'transfer.rejected',
  PACK: 'transfer.packed',
  DISPATCH: 'transfer.dispatched',
  RECEIVE: 'transfer.received',
  CANCEL: 'transfer.cancelled',
} as const;

export const TRANSFER_MAX_ITEMS = 50;
