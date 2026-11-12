import { describe, expect, test } from 'vitest';
import { getInsights, insightsRange } from './insights.js';

describe('owner insights', () => {
  test('builds the range and the equally long previous period', () => {
    expect(insightsRange('2026-11-01', '2026-11-07')).toEqual({
      start: '2026-11-01', end: '2026-11-07', days: 7, previous_start: '2026-10-25', previous_end: '2026-10-31',
    });
    expect(insightsRange('2026-03-01', '2026-03-01')).toMatchObject({ previous_start: '2026-02-28', previous_end: '2026-02-28' });
    expect(insightsRange('2026-11-07', '2026-11-01')).toBeNull();
    expect(insightsRange('11/01/2026', '2026-11-07')).toBeNull();
  });

  test('aggregates in SQL and estimates profit only from costed items', async () => {
    const calls = [];
    const fakeQuery = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SUM(o.discount_amount)')) return { rows: [{ orders: '4', revenue: '21500', discounts: '1000', tax: '1500' }] };
      if (sql.includes('FROM payments p')) return { rows: [{ count: '1', total: '3762.5' }] };
      if (sql.includes('costed_revenue') && !sql.includes('GROUP BY')) {
        return { rows: [{ revenue: '20000', quantity: '9', cost: '9000', costed_revenue: '16000' }] };
      }
      if (sql.includes('AS method')) return { rows: [{ method: 'cash', orders: '3', revenue: '15000' }, { method: 'transfer', orders: '1', revenue: '6500' }] };
      if (sql.includes('AS cashier')) return { rows: [{ cashier: 'Ada', orders: '4', revenue: '21500' }] };
      if (sql.includes('GROUP BY oi.product_name')) {
        return { rows: [
          { product_name: 'Rice', quantity: '2', revenue: '16000', cost: '9000', costed_revenue: '16000' },
          { product_name: 'Gift wrap', quantity: '7', revenue: '4000', cost: null, costed_revenue: '0' },
        ] };
      }
      return { rows: [{ orders: '2', revenue: '10000' }] };
    };

    const range = insightsRange('2026-11-01', '2026-11-07');
    const result = await getInsights(fakeQuery, 3, range);

    expect(result.summary).toEqual({ revenue: 21500, orders: 4, average_order: 5375, discounts: 1000, tax: 1500, items_sold: 9 });
    expect(result.previous).toEqual({ revenue: 10000, orders: 2 });
    expect(result.refunds).toEqual({ count: 1, total: 3762.5 });
    // Discount share: 1000 / 20000 = 5% of every item; costed net = 16000 * 0.95 = 15200.
    expect(result.profit).toEqual({ net_sales: 19000, cost: 9000, gross_profit: 6200, margin: 40.8, costed_share: 80 });
    expect(result.products[0]).toEqual({ product_name: 'Rice', quantity: 2, revenue: 16000, cost: 9000, profit: 6200 });
    expect(result.products[1]).toMatchObject({ product_name: 'Gift wrap', cost: null, profit: null });
    expect(result.payment_methods.map((row) => row.method)).toEqual(['cash', 'transfer']);

    const previousCall = calls.find((call) => call.params?.[1] === '2026-10-25');
    expect(previousCall.params).toEqual([3, '2026-10-25', '2026-10-31']);
    expect(calls.every((call) => call.params[0] === 3)).toBe(true);
  });
});
