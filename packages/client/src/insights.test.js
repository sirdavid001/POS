import assert from 'node:assert/strict';
import test from 'node:test';
import { computeInsightsFromOrders } from '../../shared/src/insights.js';

const orders = [
  {
    status: 'completed', created_at: '2026-11-05T10:00:00Z', total: 9513.75, discount_amount: 0, tax_amount: 663.75,
    payment_method: 'cash', cashier_name: 'Ada',
    items: [{ product_id: 1, product_name: 'Rice', quantity: 1, total: 8500 }, { product_id: 2, product_name: 'Water', quantity: 2, total: 350 }],
  },
  {
    status: 'completed', created_at: '2026-11-06T10:00:00Z', total: 3762.5, discount_amount: 0, tax_amount: 262.5,
    payment_method: 'transfer', cashier_name: 'Bayo',
    items: [{ product_id: 3, product_name: 'Earphones', quantity: 1, total: 3500 }],
  },
  { status: 'completed', created_at: '2026-10-30T10:00:00Z', total: 1000, payment_method: 'cash', items: [] },
  { status: 'refunded', created_at: '2026-11-06T09:00:00Z', updated_at: '2026-11-06T12:00:00Z', total: 500, items: [] },
];
const products = [{ id: 1, cost_price: 7000 }, { id: 2, cost_price: 0 }, { id: 3, cost_price: '2000' }];

test('computes offline insights with the same shape as the API', () => {
  const result = computeInsightsFromOrders({ orders, products, start: '2026-11-01', end: '2026-11-07' });
  assert.deepEqual(result.summary, { revenue: 13276.25, orders: 2, average_order: 6638.13, discounts: 0, tax: 926.25, items_sold: 4 });
  assert.deepEqual(result.previous, { revenue: 1000, orders: 1 });
  assert.deepEqual(result.refunds, { count: 1, total: 500 });
  assert.equal(result.profit.cost, 9000);
  assert.equal(result.profit.gross_profit, 3000);
  assert.equal(result.profit.costed_share, 97.2);
  assert.deepEqual(result.payment_methods.map((row) => row.method), ['cash', 'transfer']);
  assert.deepEqual(result.cashiers[0], { cashier: 'Ada', orders: 1, revenue: 9513.75 });
  assert.deepEqual(result.products.find((row) => row.product_name === 'Water'), { product_name: 'Water', quantity: 2, revenue: 350, cost: null, profit: null });
});

test('returns null for an invalid range', () => {
  assert.equal(computeInsightsFromOrders({ orders, products, start: '2026-11-07', end: '2026-11-01' }), null);
});
