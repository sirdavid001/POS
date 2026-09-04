import { createCategorySchema, updateCategorySchema } from './categories/schema.js';
import { createCustomerSchema } from './customers/schema.js';
import { adjustStockSchema, createPurchaseOrderSchema } from './inventory/schema.js';
import { recordPaymentSchema } from './payments/schema.js';
import { createProductSchema } from './products/schema.js';

describe('write endpoint validation', () => {
  test('rejects invalid product image sources and negative stock', () => {
    const product = { name: 'Tea', price: 100, stock_quantity: 2 };
    expect(createProductSchema.safeParse({
      body: { ...product, image_url: 'javascript:alert(1)' },
    }).success).toBe(false);
    expect(createProductSchema.safeParse({
      body: { ...product, stock_quantity: -1 },
    }).success).toBe(false);
    expect(createProductSchema.safeParse({
      body: { ...product, image_url: 'data:image/jpeg;base64,AAAA' },
    }).success).toBe(true);
  });

  test('requires positive stock and purchase-order quantities', () => {
    expect(adjustStockSchema.safeParse({
      body: { product_id: 1, type: 'out', quantity: 0 },
    }).success).toBe(false);
    expect(createPurchaseOrderSchema.safeParse({
      body: {
        supplier_id: 1,
        items: [{ product_id: 2, quantity: -3, unit_cost: 50 }],
      },
    }).success).toBe(false);
  });

  test('requires references for non-cash payments', () => {
    expect(recordPaymentSchema.safeParse({
      body: { order_id: 1, amount: 100, method: 'card' },
    }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({
      body: { order_id: 1, amount: 100, method: 'card', reference: 'terminal-123' },
    }).success).toBe(true);
  });

  test('validates category and customer writes', () => {
    expect(createCategorySchema.safeParse({ body: { name: '  ' } }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ params: { id: 1 }, body: {} }).success).toBe(false);
    expect(createCustomerSchema.safeParse({
      body: { name: 'Ada', email: 'not-an-email' },
    }).success).toBe(false);
  });
});
