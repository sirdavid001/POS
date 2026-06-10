import crypto from 'crypto';
import { describe, expect, test } from '@jest/globals';
import {
  getProviderAvailability,
  verifyFlutterwaveWebhook,
  verifyPaystackWebhook,
} from './providers.js';

const rawBody = Buffer.from('{"event":"charge.success","data":{"id":1}}');

describe('billing providers', () => {
  test('verifies Paystack HMAC SHA512 signatures', () => {
    const secret = 'paystack-secret';
    const signature = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    expect(verifyPaystackWebhook(rawBody, signature, secret)).toBe(true);
    expect(verifyPaystackWebhook(rawBody, 'invalid', secret)).toBe(false);
  });

  test('verifies current and legacy Flutterwave signatures', () => {
    const secret = 'flutterwave-secret';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

    expect(verifyFlutterwaveWebhook(rawBody, signature, secret)).toBe(true);
    expect(verifyFlutterwaveWebhook(rawBody, secret, secret)).toBe(true);
    expect(verifyFlutterwaveWebhook(rawBody, 'invalid', secret)).toBe(false);
  });

  test('only advertises recurring plans with provider plan identifiers', () => {
    const availability = getProviderAvailability({
      paystack: {
        secretKey: 'sk_test_valid',
        plans: { monthly: 'PLN_monthly', quarterly: '', yearly: 'PLN_yearly' },
      },
      flutterwave: {
        secretKey: 'FLWSECK_TEST-valid-X',
        webhookSecret: '',
        plans: { monthly: '1', quarterly: '2', yearly: '3' },
      },
    });

    expect(availability.paystack.plans.monthly).toBe(true);
    expect(availability.paystack.plans.quarterly).toBe(false);
    expect(availability.paystack.plans.activation_5m).toBe(true);
    expect(availability.flutterwave.available).toBe(false);
  });
});
