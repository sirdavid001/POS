import { describe, expect, test } from '@jest/globals';
import { createOrderSchema } from './schema.js';

const baseOrder = {
  items: [{ product_id: 1, quantity: 2 }],
  client_order_id: 'sale-12345678',
};

describe('order validation', () => {
  test('accepts a valid cash sale and normalizes numeric values', () => {
    const result = createOrderSchema.safeParse({
      body: { ...baseOrder, items: [{ product_id: '1', quantity: '2' }] },
    });
    expect(result.success).toBe(true);
    expect(result.data.body.items[0]).toMatchObject({ product_id: 1, quantity: 2 });
  });

  test('requires an external reference for card and transfer sales', () => {
    expect(createOrderSchema.safeParse({
      body: { ...baseOrder, payment_method: 'card' },
    }).success).toBe(false);
    expect(createOrderSchema.safeParse({
      body: { ...baseOrder, payment_method: 'transfer', payment_reference: 'BANK-9988' },
    }).success).toBe(true);
  });

  test('rejects negative discounts and non-positive quantities', () => {
    expect(createOrderSchema.safeParse({
      body: { ...baseOrder, discount_amount: -1 },
    }).success).toBe(false);
    expect(createOrderSchema.safeParse({
      body: { ...baseOrder, items: [{ product_id: 1, quantity: 0 }] },
    }).success).toBe(false);
  });
});
