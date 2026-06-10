import { describe, expect, jest, test } from '@jest/globals';
import { requireActiveSubscription } from './subscription.js';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('subscription mutation enforcement', () => {
  test('allows reads after expiry', () => {
    const next = jest.fn();
    requireActiveSubscription()(
      { method: 'GET', path: '/', subscription: { can_write: false } },
      response(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('allows mutations with a current entitlement', () => {
    const next = jest.fn();
    requireActiveSubscription()(
      { method: 'POST', path: '/', subscription: { can_write: true } },
      response(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('returns the subscription-specific 402 response after expiry', () => {
    const next = jest.fn();
    const res = response();
    requireActiveSubscription()(
      { method: 'POST', path: '/', subscription: { can_write: false, status: 'expired' } },
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SUBSCRIPTION_EXPIRED',
    }));
  });
});
