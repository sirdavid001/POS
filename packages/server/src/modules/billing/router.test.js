import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';

// The Paystack and Flutterwave accounts are shared with other businesses, so
// these tests check QuickPOS only acts on payments that are its own.

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockAxiosGet = vi.fn();

vi.doMock('../../config/database.js', () => ({
  query: mockQuery,
  getClient: vi.fn(async () => ({ query: mockClientQuery, release: vi.fn() })),
}));
vi.doMock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.doMock('axios', () => ({ default: { get: mockAxiosGet, post: vi.fn() } }));
vi.doMock('../../middleware/auth.js', () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));
vi.doMock('./subscription.js', () => ({
  addMonths: (date, months) => new Date(new Date(date).setMonth(new Date(date).getMonth() + months)),
  getPlan: vi.fn(),
  getStoreSubscription: vi.fn(async () => ({ status: 'active' })),
  hasConfirmedStorePayment: vi.fn(async () => false),
}));
vi.doMock('./email.js', () => ({ sendBillingEmail: vi.fn(async () => ({ skipped: true })) }));
vi.doMock('../notifications/support-email.js', () => ({ sendPaymentSupportNotification: vi.fn() }));
vi.doMock('../legal.js', () => ({
  LEGAL_DOCUMENT_VERSIONS: { terms: 't', refund: 'r' },
  recordLegalAcceptances: vi.fn(),
}));

const { default: billingRouter, activateVerifiedPayment } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

const PAYSTACK_SECRET = 'sk_test_quickpos';
const FLUTTERWAVE_HASH = 'flw-test-hash';
let knownToQuickpos;

function sqlCalls(fragment) {
  return mockQuery.mock.calls.filter(([text]) => String(text).includes(fragment));
}

async function post(path, body, headers) {
  const app = express();
  app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = buffer; } }));
  app.use('/billing', billingRouter);
  const server = await new Promise((resolve) => { const created = app.listen(0, () => resolve(created)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
    return response.status;
  } finally {
    server.close();
  }
}

function paystack(body) {
  const raw = JSON.stringify(body);
  const signature = crypto.createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex');
  return post('/billing/webhooks/paystack', raw, { 'x-paystack-signature': signature });
}

function flutterwave(body) {
  return post('/billing/webhooks/flutterwave', JSON.stringify(body), { 'verif-hash': FLUTTERWAVE_HASH });
}

function paystackVerified(data) {
  return { data: { status: true, data: { status: 'success', id: 777, amount: 2000000, currency: 'NGN', ...data } } };
}

beforeEach(() => {
  config.paystack.secretKey = PAYSTACK_SECRET;
  config.paystack.plans = { monthly: 'PLN_qp_monthly', quarterly: '', yearly: '' };
  config.paystack.plansByCurrency = {};
  config.flutterwave.secretKey = 'flw_test_secret';
  config.flutterwave.webhookSecret = FLUTTERWAVE_HASH;
  config.flutterwave.plans = { monthly: '9001', quarterly: '', yearly: '' };
  config.flutterwave.plansByCurrency = {};
  knownToQuickpos = false;
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('AS known')) return { rows: [{ known: knownToQuickpos }] };
    if (sql.includes('INSERT INTO billing_webhook_events')) return { rows: [{ id: 1 }] };
    return { rows: [] };
  });
  // A QuickPOS checkout that is already recorded as paid.
  mockClientQuery.mockImplementation(async (text) => {
    if (String(text).includes('FROM billing_transactions')) return { rows: [{ id: 9, status: 'success', store_id: 4 }] };
    return { rows: [] };
  });
});

afterEach(() => vi.clearAllMocks());

describe('Paystack notifications on the shared account', () => {
  test("another business's payment is answered but not stored or acted on", async () => {
    const status = await paystack({
      event: 'charge.success',
      // Another business may also put a store_id in its metadata.
      data: { reference: 'SHOP-1001', id: 555, customer: { customer_code: 'CUS_shared' }, metadata: { store_id: 4 } },
    });
    expect(status).toBe(200);
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(sqlCalls('INSERT INTO billing_webhook_events')).toHaveLength(0);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  test("QuickPOS's own checkout is verified and recorded", async () => {
    const reference = 'QP-4-1700000000000-abc123';
    mockAxiosGet.mockResolvedValue(paystackVerified({ reference, metadata: '{"source":"quickpos"}' }));
    const status = await paystack({ event: 'charge.success', data: { reference, id: 777 } });
    expect(status).toBe(200);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      `https://api.paystack.co/transaction/verify/${reference}`,
      expect.anything()
    );
    expect(sqlCalls('INSERT INTO billing_webhook_events')).toHaveLength(1);
    expect(sqlCalls('UPDATE billing_webhook_events')[0][1][0]).toBe('processed');
  });

  test('a renewal on a QuickPOS plan is matched to the store by customer', async () => {
    mockAxiosGet.mockResolvedValue(paystackVerified({
      reference: 'T_renewal_1',
      plan: 'PLN_qp_monthly',
      customer: { customer_code: 'CUS_shared' },
    }));
    let lookup;
    mockClientQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('FROM billing_transactions')) return { rows: [] };
      if (sql.includes('FROM store_subscriptions')) { lookup = params; return { rows: [{ store_id: 4, plan_code: 'monthly' }] }; }
      if (sql.includes('INSERT INTO billing_transactions')) return { rows: [{ id: 10, status: 'success', store_id: 4 }] };
      return { rows: [] };
    });
    const status = await paystack({
      event: 'charge.success',
      data: { reference: 'T_renewal_1', plan: { plan_code: 'PLN_qp_monthly' }, customer: { customer_code: 'CUS_shared' } },
    });
    expect(status).toBe(200);
    expect(lookup).toEqual(['paystack', null, 'CUS_shared', null]);
  });

  test('a failed charge for another business leaves QuickPOS stores alone', async () => {
    const status = await paystack({
      event: 'charge.failed',
      data: { reference: 'SHOP-9', customer: { customer_code: 'CUS_shared' } },
    });
    expect(status).toBe(200);
    expect(sqlCalls('UPDATE store_subscriptions')).toHaveLength(0);
  });

  test('a failed QuickPOS renewal still marks the store past due', async () => {
    const status = await paystack({
      event: 'invoice.payment_failed',
      data: {
        subscription: { subscription_code: 'SUB_qp', plan: { plan_code: 'PLN_qp_monthly' } },
        customer: { customer_code: 'CUS_shared' },
      },
    });
    expect(status).toBe(200);
    const [[, params]] = sqlCalls("SET status = 'past_due'");
    expect(params).toEqual(['SUB_qp', 'CUS_shared']);
  });

  test('a failed charge on a known QuickPOS subscription matches by subscription only', async () => {
    knownToQuickpos = true;
    const status = await paystack({
      event: 'invoice.payment_failed',
      data: { subscription: { subscription_code: 'SUB_qp' }, customer: { customer_code: 'CUS_shared' } },
    });
    expect(status).toBe(200);
    const [[, params]] = sqlCalls("SET status = 'past_due'");
    expect(params).toEqual(['SUB_qp', '']);
  });

  test("a new subscription on another business's plan is not attached to a store", async () => {
    const status = await paystack({
      event: 'subscription.create',
      data: { subscription_code: 'SUB_shop', plan: { plan_code: 'PLN_shop' }, customer: { customer_code: 'CUS_shared' } },
    });
    expect(status).toBe(200);
    expect(sqlCalls('UPDATE store_subscriptions')).toHaveLength(0);
  });

  test('a new subscription on a QuickPOS plan is recorded', async () => {
    const status = await paystack({
      event: 'subscription.create',
      data: { subscription_code: 'SUB_qp', plan: { plan_code: 'PLN_qp_monthly' }, customer: { customer_code: 'CUS_shared' } },
    });
    expect(status).toBe(200);
    expect(sqlCalls('provider_subscription_id = $1,')[0][1][0]).toBe('SUB_qp');
  });

  test('metadata that is not JSON does not break the check', async () => {
    const status = await paystack({ event: 'charge.success', data: { reference: 'SHOP-2', metadata: 'not json' } });
    expect(status).toBe(200);
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('if the check cannot run, the provider is asked to send it again', async () => {
    mockQuery.mockRejectedValueOnce(new Error('database busy'));
    const status = await paystack({ event: 'charge.success', data: { reference: 'SHOP-3' } });
    expect(status).toBe(500);
  });
});

describe('payment activation', () => {
  test('refuses a payment that only shares a customer or store number with QuickPOS', async () => {
    let lookup;
    mockClientQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('FROM billing_transactions')) return { rows: [] };
      if (sql.includes('FROM store_subscriptions')) { lookup = params; return { rows: [] }; }
      return { rows: [] };
    });
    await expect(activateVerifiedPayment('paystack', {
      reference: 'SHOP-77',
      planId: 'PLN_shop',
      providerCustomerId: 'CUS_shared',
      metadata: { store_id: 4 },
      amountNgn: 20000,
      currency: 'NGN',
    })).rejects.toMatchObject({ code: 'NOT_QUICKPOS_PAYMENT' });
    expect(lookup).toEqual(['paystack', null, null, null]);
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  test('a QuickPOS reference ties a renewal to its store', async () => {
    let lookup;
    mockClientQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('FROM billing_transactions')) return { rows: [] };
      if (sql.includes('FROM store_subscriptions')) { lookup = params; return { rows: [{ store_id: 4, plan_code: 'monthly' }] }; }
      if (sql.includes('INSERT INTO billing_transactions')) return { rows: [{ id: 11, status: 'success', store_id: 4 }] };
      return { rows: [] };
    });
    await activateVerifiedPayment('flutterwave', {
      reference: 'QP-4-1700000000000-abc123_renewal',
      providerCustomerId: '3',
      metadata: {},
      amountNgn: 20000,
      currency: 'NGN',
    });
    expect(lookup).toEqual(['flutterwave', null, null, 4]);
  });
});

describe('Flutterwave notifications on the shared account', () => {
  test("another business's charge is answered but not stored or acted on", async () => {
    const status = await flutterwave({
      event: 'charge.completed',
      data: { id: 88, tx_ref: 'SHOP-FLW-1', status: 'successful', customer: { id: 3 } },
    });
    expect(status).toBe(200);
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(sqlCalls('INSERT INTO billing_webhook_events')).toHaveLength(0);
  });

  test("QuickPOS's own checkout is verified", async () => {
    const reference = 'QP-4-1700000000000-abc123';
    mockAxiosGet.mockResolvedValue({
      data: { status: 'success', data: { id: 88, tx_ref: reference, status: 'successful', amount: 20000, currency: 'NGN' } },
    });
    const status = await flutterwave({ event: 'charge.completed', data: { id: 88, tx_ref: reference, status: 'successful' } });
    expect(status).toBe(200);
    expect(mockAxiosGet).toHaveBeenCalledWith('https://api.flutterwave.com/v3/transactions/88/verify', expect.anything());
  });

  test('QuickPOS metadata sent alongside the charge counts as QuickPOS', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { status: 'success', data: { id: 89, tx_ref: 'FLW-RENEW-2', status: 'successful', amount: 20000, currency: 'NGN' } },
    });
    mockClientQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM billing_transactions')) return { rows: [] };
      return { rows: [] };
    });
    const status = await flutterwave({
      event: 'charge.completed',
      data: { id: 89, tx_ref: 'FLW-RENEW-2', status: 'successful' },
      meta_data: { source: 'quickpos', store_id: 4 },
    });
    expect(mockAxiosGet).toHaveBeenCalled();
    // The verified charge itself carries no QuickPOS sign, so it is still refused, quietly.
    expect(status).toBe(200);
    expect(sqlCalls('DELETE FROM billing_webhook_events')).toHaveLength(1);
  });
});

describe('Flutterwave renewals, which name no plan or subscription', () => {
  const renewal = {
    reference: 'FLW-AUTO-31',
    providerCustomerId: '3',
    customerEmail: 'owner@store.example',
    metadata: {},
    amountNgn: 20000,
    currency: 'NGN',
  };
  let lookup;

  beforeEach(() => {
    lookup = undefined;
    mockClientQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('FROM billing_transactions')) return { rows: [] };
      if (sql.includes('FROM store_subscriptions')) {
        lookup = params;
        return { rows: params[2] ? [{ store_id: 4, plan_code: 'monthly' }] : [] };
      }
      if (sql.includes('INSERT INTO billing_transactions')) return { rows: [{ id: 12, status: 'success', store_id: 4 }] };
      return { rows: [] };
    });
  });

  function subscriptions(list) {
    mockAxiosGet.mockResolvedValue({ data: { status: 'success', data: list } });
  }

  test('counts when Flutterwave shows an active QuickPOS plan at the charged amount', async () => {
    subscriptions([{ id: 51, amount: 20000, plan: 9001, status: 'active' }]);
    await activateVerifiedPayment('flutterwave', renewal);
    expect(mockAxiosGet).toHaveBeenCalledWith('https://api.flutterwave.com/v3/subscriptions', expect.objectContaining({
      params: { email: 'owner@store.example', status: 'active' },
    }));
    expect(lookup).toEqual(['flutterwave', null, '3', null]);
  });

  test("is refused when the customer's subscription is another business's plan", async () => {
    subscriptions([{ id: 52, amount: 20000, plan: 7777, status: 'active' }]);
    await expect(activateVerifiedPayment('flutterwave', renewal)).rejects.toMatchObject({ code: 'NOT_QUICKPOS_PAYMENT' });
    expect(lookup).toEqual(['flutterwave', null, null, null]);
  });

  test('is refused when the amount is not the QuickPOS subscription amount', async () => {
    subscriptions([{ id: 51, amount: 20000, plan: 9001, status: 'active' }]);
    await expect(activateVerifiedPayment('flutterwave', { ...renewal, amountNgn: 4500 }))
      .rejects.toMatchObject({ code: 'NOT_QUICKPOS_PAYMENT' });
  });

  test('a charge from a QuickPOS customer is passed on for that check', async () => {
    knownToQuickpos = true;
    mockAxiosGet
      .mockResolvedValueOnce({ data: { status: 'success', data: {
        id: 90, tx_ref: 'FLW-AUTO-32', status: 'successful', amount: 4500, currency: 'NGN',
        customer: { id: 3, email: 'owner@store.example' },
      } } })
      .mockResolvedValueOnce({ data: { status: 'success', data: [{ id: 51, amount: 20000, plan: 9001, status: 'active' }] } });
    const status = await flutterwave({
      event: 'charge.completed',
      data: { id: 90, tx_ref: 'FLW-AUTO-32', status: 'successful', customer: { id: 3 } },
    });
    const [[, params]] = sqlCalls('AS known');
    expect(params[3]).toEqual(['3']);
    // Another business charged a QuickPOS customer ₦4,500: answered, then forgotten.
    expect(status).toBe(200);
    expect(sqlCalls('DELETE FROM billing_webhook_events')).toHaveLength(1);
  });
});
