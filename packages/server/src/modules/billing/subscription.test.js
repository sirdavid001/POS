import { describe, expect, test } from 'vitest';
import { addMonths, serializeSubscription } from './subscription.js';

const now = new Date('2026-06-10T12:00:00.000Z');

describe('subscription entitlement boundaries', () => {
  test('keeps a new store pending until the initial activation is paid', () => {
    const subscription = serializeSubscription({
      id: 4,
      store_id: 4,
      status: 'pending_activation',
      activation_fee_paid: false,
      current_period_end: null,
      cancel_at_period_end: false,
    }, now);

    expect(subscription.status).toBe('pending_activation');
    expect(subscription.activation_required).toBe(true);
    expect(subscription.can_write).toBe(false);
  });

  test('requires payment even if a legacy trial would still be open', () => {
    const subscription = serializeSubscription({
      id: 1,
      store_id: 1,
      status: 'trialing',
      trial_ends_at: '2026-06-12T12:00:00.000Z',
      current_period_end: null,
      cancel_at_period_end: false,
      launch_offer_redeemed: false,
      activation_fee_paid: false,
    }, now);

    expect(subscription.can_write).toBe(false);
    expect(subscription.status).toBe('pending_activation');
    expect(subscription.activation_required).toBe(true);
    expect(subscription.offline_valid_until).toBe(now.toISOString());
  });

  test('expires at the exact paid-period boundary', () => {
    const subscription = serializeSubscription({
      id: 2,
      store_id: 2,
      status: 'active',
      current_period_end: now.toISOString(),
      cancel_at_period_end: false,
      launch_offer_redeemed: false,
      activation_fee_paid: true,
      has_confirmed_payment: true,
    }, now);

    expect(subscription.status).toBe('expired');
    expect(subscription.can_write).toBe(false);
  });

  test('does not grant a legacy account access solely from its old activation flag', () => {
    const subscription = serializeSubscription({
      id: 3,
      store_id: 3,
      status: 'grandfathered',
      activation_fee_paid: true,
      cancel_at_period_end: false,
      launch_offer_redeemed: false,
    }, now);

    expect(subscription.status).toBe('pending_activation');
    expect(subscription.activation_required).toBe(true);
    expect(subscription.can_write).toBe(false);
    expect(subscription.offline_valid_until).toBe(now.toISOString());
  });

  test('keeps month-end billing on the final valid calendar day', () => {
    expect(addMonths(new Date('2026-01-31T12:00:00.000Z'), 1).toISOString())
      .toBe('2026-02-28T12:00:00.000Z');
  });

  test('staff tools require payment evidence and time left in a paid period', () => {
    const end = '2026-06-14T12:00:00.000Z';
    const paid = { status: 'active', current_period_end: end, activation_fee_paid: true, has_confirmed_payment: true };
    expect(serializeSubscription(paid, now).paid_staff_tools).toBe(true);
    expect(serializeSubscription({ ...paid, status: 'cancelled' }, now).paid_staff_tools).toBe(true);
    expect(serializeSubscription({ ...paid, has_confirmed_payment: false }, now).paid_staff_tools).toBe(false);
    expect(serializeSubscription({ ...paid, status: 'grandfathered' }, now).paid_staff_tools).toBe(true);
    expect(serializeSubscription({ ...paid, status: 'grandfathered', current_period_end: null }, now).paid_staff_tools).toBe(false);
    expect(serializeSubscription({ ...paid, status: 'trialing', trial_ends_at: end }, now).paid_staff_tools).toBe(false);
    expect(serializeSubscription(paid, new Date(end)).paid_staff_tools).toBe(false);
  });
});
