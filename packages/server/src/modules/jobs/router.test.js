import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';

const mockQuery = vi.fn();
const mockVerify = vi.fn();
const mockActivate = vi.fn();

vi.doMock('../../config/database.js', () => ({ query: mockQuery }));
vi.doMock('../billing/router.js', () => ({
  verifyProviderTransaction: mockVerify,
  activateVerifiedPayment: mockActivate,
}));
vi.doMock('../billing/email.js', () => ({ sendBillingEmail: vi.fn(async () => ({ skipped: true })) }));
vi.doMock('../auth/welcome-email.js', () => ({ sendWelcomeEmail: vi.fn() }));
vi.doMock('../auth/activation-reminder-queue.js', () => ({ scheduleActivationReminder: vi.fn() }));
vi.doMock('../growth/review-request.js', () => ({ sendReviewRequests: vi.fn(async () => ({ sent: 0 })) }));

const { default: jobsRouter } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

const pending = [
  { id: 11, store_id: 4, provider: 'paystack', provider_reference: 'QP-PAID', provider_transaction_id: null },
  { id: 12, store_id: 5, provider: 'flutterwave', provider_reference: 'QP-ABANDONED', provider_transaction_id: null },
];
let order;

async function call(method, path) {
  const app = express();
  app.use(express.json());
  app.use('/jobs', jobsRouter);
  app.use((error, req, res, _next) => res.status(500).json({ error: error.message }));
  const server = await new Promise((resolve) => { const created = app.listen(0, () => resolve(created)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { Authorization: 'Bearer test-cron-secret', 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  config.billing.cronSecret = 'test-cron-secret';
  order = [];
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes("WHERE status = 'initialized'")) { order.push('check payments'); return { rows: pending }; }
    if (sql.includes('UPDATE store_subscriptions')) { order.push('expire'); return { rows: [] }; }
    if (sql.includes('SELECT status FROM billing_transactions')) return { rows: [{ status: 'success' }] };
    return { rows: [] };
  });
  mockVerify.mockImplementation(async (provider, reference) => {
    if (reference === 'QP-ABANDONED') throw Object.assign(new Error('Payment not complete'), { code: 'PAYMENT_NOT_COMPLETE' });
    return { reference, amountNgn: 20000, currency: 'NGN' };
  });
  mockActivate.mockResolvedValue({});
});

afterEach(() => vi.clearAllMocks());

describe('payment reconciliation', () => {
  test('the daily job confirms paid checkouts before expiring anything', async () => {
    const response = await call('GET', '/jobs/subscription-reminders');
    expect(response.status).toBe(200);
    expect(order).toEqual(['check payments', 'expire']);
    expect(mockActivate).toHaveBeenCalledOnce();
    expect(mockActivate).toHaveBeenCalledWith('paystack', expect.objectContaining({ reference: 'QP-PAID' }));
    expect(response.body.payments).toMatchObject({ checked: 2, reconciled: 1 });
  });

  test('only recent checkouts are checked, newest first', async () => {
    await call('POST', '/jobs/reconcile-payments');
    const [sql, params] = mockQuery.mock.calls.find(([text]) => String(text).includes("WHERE status = 'initialized'"));
    expect(String(sql)).toContain('ORDER BY created_at DESC');
    expect(String(sql)).toContain('make_interval(days => $2::int)');
    expect(params).toEqual([null, 14, 100]);
  });

  test('can be run on demand for one store, by GET or POST', async () => {
    const response = await call('GET', '/jobs/reconcile-payments?store_id=4');
    expect(response.status).toBe(200);
    const [, params] = mockQuery.mock.calls.find(([text]) => String(text).includes("WHERE status = 'initialized'"));
    expect(params[0]).toBe(4);
    expect((await call('GET', '/jobs/reconcile-payments?store_id=abc')).status).toBe(400);
  });

  test('a provider outage does not stop the daily reminders', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes("WHERE status = 'initialized'")) throw new Error('database busy');
      if (sql.includes('UPDATE store_subscriptions')) { order.push('expire'); return { rows: [] }; }
      return { rows: [] };
    });
    const response = await call('GET', '/jobs/subscription-reminders');
    expect(response.status).toBe(200);
    expect(order).toEqual(['expire']);
    expect(response.body.payments).toEqual({ error: 'database busy' });
  });

  test('rejects calls without the cron secret', async () => {
    const app = express();
    app.use('/jobs', jobsRouter);
    const server = await new Promise((resolve) => { const created = app.listen(0, () => resolve(created)); });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/jobs/reconcile-payments`);
      expect(response.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
