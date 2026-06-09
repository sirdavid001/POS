import { jest } from '@jest/globals';

import {
  createStatementExcel,
  createStatementFilename,
  createStatementPdf,
  getCustomerStatement,
  normalizeStatementFilters,
} from './statement.js';

const baseStatement = {
  customer: {
    id: 7,
    name: 'Ada Customer',
    email: 'ada@example.com',
    phone: '+234 800 000 0000',
    address: 'Lagos',
  },
  store: {
    id: 1,
    name: 'QuickPOS Store',
    address: 'Lagos',
    phone: '+234 800 111 2222',
    email: 'store@example.com',
    currency: 'NGN',
  },
  period: {
    start_date: '2026-06-01',
    end_date: '2026-06-30',
    label: '1 Jun 2026 to 30 Jun 2026',
  },
  summary: {
    total_orders: 1,
    completed_orders: 1,
    total_spent: 1250,
    total_tax: 50,
    total_discount: 0,
    average_order_value: 1250,
  },
  transactions: [{
    id: 1,
    order_number: 'ORD-001',
    created_at: '2026-06-09T12:00:00.000Z',
    payment_method: 'cash',
    status: 'completed',
    cashier_name: 'Cashier',
    item_count: 2,
    subtotal: 1200,
    tax_amount: 50,
    discount_amount: 0,
    total: 1250,
    cumulative_total: 1250,
  }],
  generated_at: '2026-06-09T13:00:00.000Z',
};

describe('customer account statements', () => {
  test('validates statement date filters', () => {
    expect(normalizeStatementFilters({
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    })).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });

    expect(() => normalizeStatementFilters({
      start_date: '2026-07-01',
      end_date: '2026-06-30',
    })).toThrow('start_date cannot be after end_date');

    expect(() => normalizeStatementFilters({ start_date: '2026-02-30' }))
      .toThrow('start_date is not a valid date');
  });

  test('builds totals and excludes cancelled orders from cumulative spend', async () => {
    const queryFn = jest.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          name: 'Ada Customer',
          email: 'ada@example.com',
          phone: null,
          address: null,
          loyalty_points: 0,
          created_at: '2026-01-01T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, name: 'QuickPOS Store', currency: 'NGN' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            order_number: 'ORD-001',
            created_at: '2026-06-01T10:00:00.000Z',
            subtotal: '1000.00',
            tax_amount: '75.00',
            discount_amount: '0.00',
            total: '1075.00',
            payment_method: 'cash',
            status: 'completed',
            cashier_name: 'Cashier',
            item_count: 2,
          },
          {
            id: 2,
            order_number: 'ORD-002',
            created_at: '2026-06-02T10:00:00.000Z',
            subtotal: '500.00',
            tax_amount: '37.50',
            discount_amount: '0.00',
            total: '537.50',
            payment_method: 'card',
            status: 'cancelled',
            cashier_name: 'Cashier',
            item_count: 1,
          },
        ],
      });

    const statement = await getCustomerStatement(
      7,
      1,
      { start_date: '2026-06-01', end_date: '2026-06-30' },
      queryFn
    );

    expect(statement.summary.total_orders).toBe(2);
    expect(statement.summary.completed_orders).toBe(1);
    expect(statement.summary.total_spent).toBe(1075);
    expect(statement.transactions.map((item) => item.cumulative_total)).toEqual([1075, 1075]);
  });

  test('generates PDF and Excel attachments', async () => {
    const [pdf, excel] = await Promise.all([
      createStatementPdf(baseStatement),
      createStatementExcel(baseStatement),
    ]);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(1);
    expect(excel.subarray(0, 2).toString()).toBe('PK');
    expect(createStatementFilename(baseStatement, 'pdf'))
      .toBe('statement-ada-customer-2026-06-30.pdf');
  });
});
