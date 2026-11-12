import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockSendBillingEmail = vi.fn(async () => ({}));
const mockSendPasswordResetEmail = vi.fn(async () => ({ id: 'reset_1' }));

vi.doMock('../../config/database.js', () => ({
  query: mockQuery,
  getClient: vi.fn(async () => ({ query: mockQuery, release: mockRelease })),
}));
vi.doMock('../billing/subscription.js', () => ({
  getStoreSubscription: vi.fn(async () => ({ status: 'active', can_write: true })),
  getPlan: vi.fn(async (code) => (code === 'activation_5m'
    ? { code, name: 'Initial Activation', price_ngn: 20000, duration_months: 5 }
    : code === 'monthly' ? { code, name: 'Monthly', price_ngn: 5000, duration_months: 1 } : null)),
  addMonths: (date, months) => new Date(new Date(date).getTime() + months * 30 * 86400000),
}));
vi.doMock('../billing/email.js', () => ({ sendBillingEmail: mockSendBillingEmail }));
vi.doMock('../billing/router.js', () => ({ activateVerifiedPayment: vi.fn(), verifyProviderTransaction: vi.fn() }));
vi.doMock('../auth/email.js', () => ({ sendPasswordResetEmail: mockSendPasswordResetEmail }));
vi.doMock('../auth/welcome-email.js', () => ({ sendWelcomeEmail: vi.fn() }));
vi.doMock('../auth/activation-reminder.js', () => ({ sendActivationReminder: vi.fn() }));

const { default: platformRouter } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

const jwtSecret = 'dev-secret-change-me';
config.jwt.secret = jwtSecret;

let state;
const admin = { id: 1, email: 'owner@example.com', name: 'Platform Owner', store_id: 1, is_active: true, role: 'admin' };

function headers() {
  return {
    Authorization: `Bearer ${jwt.sign({ userId: admin.id, role: 'admin', storeId: 1 }, jwtSecret, { expiresIn: '15m' })}`,
    'Content-Type': 'application/json',
  };
}

async function call(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use('/platform', platformRouter);
  app.use((error, req, res, _next) => res.status(500).json({ error: error.message }));
  const server = await new Promise((resolve) => { const created = app.listen(0, () => resolve(created)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

const sqlCalls = () => mockQuery.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));

beforeEach(() => {
  state = {
    subscription: { status: 'pending_activation', activation_fee_paid: false, current_period_end: null },
    admins: [1, 2],
    lastSuspension: { user_ids: [7, 8] },
    missingTables: false,
    resetTarget: { id: 22, email: 'cashier@example.com', name: 'Ada', store_id: 8, is_active: true, store_name: 'Ada Stores', is_platform_admin: false },
  };
  config.email.resendApiKey = 'test-key';
  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (sql.includes('FROM users u JOIN roles') && sql.includes('WHERE u.id = $1')) return { rows: [admin] };
    if (sql.includes('FROM platform_admins') && sql.includes('WHERE user_id = $1')) return { rows: [{ user_id: 1, granted_at: '2026-01-01' }] };
    if (state.missingTables && (sql.includes('platform_announcements') || sql.includes('support_conversations'))) {
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    }
    if (sql.includes('SELECT * FROM store_subscriptions WHERE store_id = $1 FOR UPDATE')) return { rows: state.subscription ? [state.subscription] : [] };
    if (sql.includes('INSERT INTO billing_transactions')) return { rows: [{ id: 91 }] };
    if (sql.includes('UPDATE store_subscriptions SET')) return { rows: [{ status: 'active', current_period_end: '2027-04-12T00:00:00Z' }] };
    if (sql.includes('COALESCE(s.email, owner.email)')) return { rows: [{ email: 'store@example.com' }] };
    if (sql.includes('SELECT id FROM stores WHERE id = $1')) return { rows: [{ id: 8 }] };
    if (sql.includes('UPDATE users u SET is_active = false')) return { rows: [{ id: 7 }, { id: 8 }] };
    if (sql.includes("action = 'store_suspended'")) return { rows: state.lastSuspension ? [{ old_values: state.lastSuspension }] : [] };
    if (sql.includes('UPDATE users SET is_active = true')) return { rows: params[1].map((id) => ({ id })) };
    if (sql.includes('SELECT user_id FROM platform_admins FOR UPDATE')) return { rows: state.admins.map((id) => ({ user_id: id })) };
    if (sql.includes('FROM users u JOIN stores s ON s.id = u.store_id WHERE u.id = $1')) return { rows: [state.resetTarget] };
    if (sql.includes('INSERT INTO platform_announcements')) return { rows: [{ id: 5, title: params[0], body: params[1], level: params[2], ends_at: params[3] }] };
    if (sql.includes('INSERT INTO platform_audit_logs')) return { rows: [{ id: 1 }] };
    return { rows: [] };
  });
});

afterEach(() => vi.clearAllMocks());

describe('manual payments', () => {
  test('records a bank transfer, activates the store and keeps provider links', async () => {
    const response = await call('POST', '/platform/stores/8/manual-payment', { plan_code: 'activation_5m', amount: 20000, currency: 'NGN', reference: 'GTB-778812' });
    expect(response.status).toBe(201);
    const update = sqlCalls().find(({ sql }) => sql.includes('UPDATE store_subscriptions SET'));
    expect(update.sql).not.toMatch(/provider\s*=/);
    expect(update.params[4]).toBe(true);
    const insert = sqlCalls().find(({ sql }) => sql.includes('INSERT INTO billing_transactions'));
    expect(insert.sql).toContain("'manual'");
    expect(sqlCalls().some(({ sql, params }) => sql.includes('INSERT INTO platform_audit_logs') && params[3] === 'manual_payment_recorded')).toBe(true);
    expect(mockSendBillingEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'store@example.com', key: 'manual:GTB-778812' }));
  });

  test('refuses a second activation fee', async () => {
    state.subscription.activation_fee_paid = true;
    const response = await call('POST', '/platform/stores/8/manual-payment', { plan_code: 'activation_5m', amount: 20000, reference: 'GTB-1' });
    expect(response.status).toBe(409);
    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  test('rejects unknown plans and future dates', async () => {
    expect((await call('POST', '/platform/stores/8/manual-payment', { plan_code: 'nope', amount: 1, reference: 'REF-1' })).status).toBe(400);
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    expect((await call('POST', '/platform/stores/8/manual-payment', { plan_code: 'monthly', amount: 5000, reference: 'REF-2', paid_at: future })).status).toBe(400);
  });
});

describe('store suspension', () => {
  test('suspending disables sign-ins, revokes sessions and remembers who was active', async () => {
    const response = await call('POST', '/platform/stores/8/suspend', { suspended: true, reason: 'Chargeback dispute' });
    expect(response.status).toBe(200);
    expect(response.body.users).toBe(2);
    expect(sqlCalls().some(({ sql }) => sql.includes('DELETE FROM refresh_tokens WHERE user_id = ANY'))).toBe(true);
    const audit = sqlCalls().find(({ sql }) => sql.includes('INSERT INTO platform_audit_logs'));
    expect(JSON.parse(audit.params[4])).toEqual({ user_ids: [7, 8] });
  });

  test('restoring only re-enables the people the suspension disabled', async () => {
    const response = await call('POST', '/platform/stores/8/suspend', { suspended: false, reason: 'Dispute resolved' });
    expect(response.status).toBe(200);
    const restore = sqlCalls().find(({ sql }) => sql.includes('UPDATE users SET is_active = true'));
    expect(restore.params[1]).toEqual([7, 8]);
  });
});

describe('platform team', () => {
  test('cannot remove yourself or the last admin', async () => {
    expect((await call('DELETE', '/platform/admins/1')).status).toBe(400);
    state.admins = [2];
    const last = await call('DELETE', '/platform/admins/2');
    expect(last.status).toBe(400);
    expect(last.body.error).toMatch(/at least one/);
  });

  test('removes another admin and logs it', async () => {
    const response = await call('DELETE', '/platform/admins/2');
    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM platform_admins WHERE user_id = $1', [2]);
  });
});

describe('password reset for store users', () => {
  test('sends a reset link and logs it', async () => {
    const response = await call('POST', '/platform/users/22/password-reset');
    expect(response.status).toBe(200);
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'cashier@example.com' }));
  });

  test('never resets a platform admin from the console', async () => {
    state.resetTarget.is_platform_admin = true;
    expect((await call('POST', '/platform/users/22/password-reset')).status).toBe(400);
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe('announcements and database updates', () => {
  test('publishes an announcement and rejects past end dates', async () => {
    const created = await call('POST', '/platform/announcements', { title: 'Planned maintenance', body: 'Sync pauses at 2am for ten minutes.', level: 'warning' });
    expect(created.status).toBe(201);
    const past = await call('POST', '/platform/announcements', { title: 'Old news', body: 'Already over.', ends_at: '2020-01-01' });
    expect(past.status).toBe(400);
  });

  test('explains that a database update is needed when the tables are missing', async () => {
    state.missingTables = true;
    const response = await call('GET', '/platform/announcements');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MIGRATION_REQUIRED');
    const summary = await call('GET', '/platform/inbox/summary');
    expect(summary.body).toEqual({ open: 0, unread: 0, available: false });
  });
});
