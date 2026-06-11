import { describe, expect, test } from '@jest/globals';
import { registerSchema } from './schema.js';
import { checkoutSchema } from '../billing/schema.js';

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
});
