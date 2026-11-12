import { describe, expect, test } from 'vitest';
import { refundOrder, RefundError } from './refund.js';
import { refundOrderSchema } from './schema.js';

function fakeClient({ order, items = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('FROM orders WHERE id')) return { rows: order ? [order] : [] };
      if (sql.includes('FROM order_items')) return { rows: items };
      if (sql.includes('UPDATE products')) return { rows: [{ id: params[1] }] };
      if (sql.includes('UPDATE orders')) return { rows: [{ ...order, status: 'refunded' }] };
      return { rows: [] };
    },
  };
}

const completed = { id: 7, store_id: 3, order_number: 'ORD-ABC', status: 'completed', total: '1500.00', payment_method: 'cash' };
const items = [
  { product_id: 11, product_name: 'Rice', quantity: 2 },
  { product_id: null, product_name: 'Deleted item', quantity: 1 },
];

describe('order refunds', () => {
  test('refunds a completed sale, restocks items and records a negative payment', async () => {
    const client = fakeClient({ order: completed, items });
    const result = await refundOrder(client, { orderId: 7, storeId: 3, userId: 5, reason: 'Wrong item', restock: true });

    expect(result.order.status).toBe('refunded');
    expect(result.refund).toMatchObject({ amount: 1500, restocked: true, restocked_items: 1 });

    const restock = client.calls.find((call) => call.sql.startsWith('UPDATE products'));
    expect(restock.params).toEqual([2, 11, 3]);
    const log = client.calls.find((call) => call.sql.startsWith('INSERT INTO inventory_logs'));
    expect(log.params).toEqual([11, 3, 5, 2, 'Refund ORD-ABC']);
    const payment = client.calls.find((call) => call.sql.startsWith('INSERT INTO payments'));
    expect(payment.params.slice(0, 4)).toEqual([7, 3, -1500, 'cash']);
    expect(JSON.parse(payment.params[4])).toMatchObject({ reason: 'Wrong item', refunded_by: 5, restocked: true });
    expect(client.calls.some((call) => call.sql.startsWith('INSERT INTO audit_logs'))).toBe(true);
  });

  test('can refund without returning items to stock', async () => {
    const client = fakeClient({ order: completed, items });
    const result = await refundOrder(client, { orderId: 7, storeId: 3, userId: 5, reason: 'Damaged goods', restock: false });
    expect(result.refund.restocked_items).toBe(0);
    expect(client.calls.some((call) => call.sql.startsWith('UPDATE products'))).toBe(false);
    expect(client.calls.some((call) => call.sql.startsWith('INSERT INTO inventory_logs'))).toBe(false);
  });

  test('refuses unknown, already refunded and non-completed sales', async () => {
    await expect(refundOrder(fakeClient({ order: null }), { orderId: 1, storeId: 3, userId: 5, reason: 'x' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(refundOrder(fakeClient({ order: { ...completed, status: 'refunded' } }), { orderId: 7, storeId: 3, userId: 5, reason: 'x' }))
      .rejects.toBeInstanceOf(RefundError);
    await expect(refundOrder(fakeClient({ order: { ...completed, status: 'pending' } }), { orderId: 7, storeId: 3, userId: 5, reason: 'x' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('requires a reason and defaults to restocking', () => {
    expect(refundOrderSchema.safeParse({ params: { id: '7' }, body: { reason: '' } }).success).toBe(false);
    const parsed = refundOrderSchema.safeParse({ params: { id: '7' }, body: { reason: 'Customer returned it' } });
    expect(parsed.success).toBe(true);
    expect(parsed.data.body.restock).toBe(true);
    expect(parsed.data.params.id).toBe(7);
  });
});
