// Shared constants for the POS system

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  CASHIER: 'cashier',
};

export const ORDER_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  TRANSFER: 'transfer',
};

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
};

export const PAYMENT_PROVIDERS = {
  CASH: 'cash',
  PAYSTACK: 'paystack',
  STRIPE: 'stripe',
};

export const INVENTORY_LOG_TYPES = {
  IN: 'in',
  OUT: 'out',
  ADJUSTMENT: 'adjustment',
};

export const PURCHASE_ORDER_STATUS = {
  PENDING: 'pending',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};
