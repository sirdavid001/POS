import { describe, expect, test } from '@jest/globals';
import { serializeSubscription } from './subscription.js';

const now = new Date('2026-06-10T12:00:00.000Z');

describe('subscription entitlement boundaries', () => {
  test('allows an active trial but never caches it beyond its known expiry', () => {
    const subscription = serializeSubscription({
      id: 1,
      store_id: 1,
      status: 'trialing',
      trial_ends_at: '2026-06-12T12:00:00.000Z',
      current_period_end: null,
      cancel_at_period_end: false,
      launch_offer_redeemed: false,
    }, now);

    expect(subscription.can_write).toBe(true);
    expect(subscription.status).toBe('trialing');
    expect(subscription.offline_valid_until).toBe('2026-06-12T12:00:00.000Z');
  });

  test('expires at the exact paid-period boundary', () => {
    const subscription = serializeSubscription({
      id: 2,
      store_id: 2,
      status: 'active',
      current_period_end: now.toISOString(),
      cancel_at_period_end: false,
      launch_offer_redeemed: false,
    }, now);

    expect(subscription.status).toBe('expired');
    expect(subscription.can_write).toBe(false);
  });

  test('limits grandfathered offline access to seven days between checks', () => {
    const subscription = serializeSubscription({
      id: 3,
      store_id: 3,
      status: 'grandfathered',
      cancel_at_period_end: false,
      launch_offer_redeemed: false,
    }, now);

    expect(subscription.can_write).toBe(true);
    expect(subscription.offline_valid_until).toBe('2026-06-17T12:00:00.000Z');
  });
});
