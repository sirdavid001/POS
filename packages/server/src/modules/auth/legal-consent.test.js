import { describe, expect, test } from 'vitest';
import { registerSchema } from './schema.js';
import { checkoutSchema, paymentConfirmationSchema } from '../billing/schema.js';

const registration = {
  email: 'owner@example.com',
  password: 'correct-horse-battery-staple',
  name: 'Store Owner',
  store_name: 'Example Store',
};

describe('legal acknowledgements', () => {
  test('requires registration terms acceptance and privacy acknowledgement', () => {
    expect(registerSchema.safeParse({ body: registration }).success).toBe(false);
    expect(registerSchema.safeParse({
      body: {
        ...registration,
        terms_accepted: true,
        privacy_acknowledged: true,
      },
    }).success).toBe(true);
  });

  test('requires acknowledgement before subscription checkout', () => {
    const checkout = { provider: 'paystack', plan_code: 'monthly' };
    expect(checkoutSchema.safeParse(checkout).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...checkout, legal_acknowledged: true }).success).toBe(true);
  });

  test('validates store-scoped payment confirmation input', () => {
    expect(paymentConfirmationSchema.safeParse({
      provider: 'paystack',
      reference: 'QP-19-example',
    }).success).toBe(true);
    expect(paymentConfirmationSchema.safeParse({
      provider: 'flutterwave',
      reference: 'QP-19-example',
      transaction_id: 12345,
    }).data.transaction_id).toBe('12345');
    expect(paymentConfirmationSchema.safeParse({
      provider: 'unknown',
      reference: '',
    }).success).toBe(false);
  });
});
