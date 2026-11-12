import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockGetStoreSubscription = vi.fn();
const mockSendWelcomeEmail = vi.fn();
const mockSendActivationReminder = vi.fn();

vi.doMock('../../config/database.js', () => ({
  query: mockQuery,
  getClient: vi.fn(async () => ({ query: mockQuery, release: mockRelease })),
}));

vi.doMock('../billing/subscription.js', () => ({
  getStoreSubscription: mockGetStoreSubscription,
}));

vi.doMock('../auth/welcome-email.js', () => ({ sendWelcomeEmail: mockSendWelcomeEmail }));
vi.doMock('../auth/activation-reminder.js', () => ({ sendActivationReminder: mockSendActivationReminder }));

const { default: platformRouter } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

const jwtSecret = 'dev-secret-change-me';
config.jwt.secret = jwtSecret;

let isPlatformAdmin;
let currentUser;
let targetUser;
let subscription;

function authHeaders() {
  return {
    Authorization: `Bearer ${jwt.sign({
      userId: currentUser.id,
      role: currentUser.role,
      storeId: currentUser.store_id,
    }, jwtSecret, { expiresIn: '15m' })}`,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/platform', platformRouter);
  app.use((error, req, res, _next) => res.status(500).json({ error: error.message }));
  const server = await new Promise((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  server.baseUrl = `http://127.0.0.1:${server.address().port}`;
  return server;
}

beforeEach(() => {
  isPlatformAdmin = true;
  currentUser = {
    id: 1,
    email: 'owner@example.com',
    name: 'Platform Owner',
    store_id: 1,
    is_active: true,
    role: 'admin',
  };
  targetUser = {
    id: 22,
    store_id: 8,
    name: 'Customer Owner',
    email: 'customer@example.com',
    is_active: true,
    is_platform_admin: false,
  };
  subscription = { store_id: 8, status: 'pending_activation', current_period_start: null, current_period_end: null };
  mockGetStoreSubscription.mockResolvedValue({ status: 'active', can_write: true });
  mockSendWelcomeEmail.mockResolvedValue({ id: 'email_1' });
  mockSendActivationReminder.mockResolvedValue({ id: 'email_2' });
  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (sql.includes('FROM users u JOIN roles') && sql.includes('WHERE u.id = $1')) {
      return { rows: [currentUser] };
    }
    if (sql.includes('FROM platform_admins') && sql.includes('WHERE user_id = $1')) {
      return { rows: isPlatformAdmin ? [{ user_id: currentUser.id, granted_at: new Date().toISOString() }] : [] };
    }
    if (sql.includes('FROM users u WHERE u.id = $1')) {
      return { rows: [targetUser] };
    }
    if (sql.includes('UPDATE users SET is_active')) {
      targetUser = { ...targetUser, is_active: params[0] };
      return { rows: [targetUser] };
    }
    if (sql.includes('FROM store_subscriptions WHERE store_id = $1')) {
      return { rows: subscription ? [subscription] : [] };
    }
    if (sql.includes('UPDATE store_subscriptions')) {
      return { rows: [{ status: 'active', current_period_start: '2026-11-12T00:00:00Z', current_period_end: '2026-12-12T00:00:00Z' }] };
    }
    if (sql.includes('SELECT id FROM stores WHERE id = $1')) {
      return { rows: params[0] === 8 ? [{ id: 8 }] : [] };
    }
    if (sql.includes('COALESCE(s.email, owner.email) AS email')) {
      return { rows: [{ id: 8, store_name: 'Ada Stores', email: 'ada@example.com', owner_name: 'Ada' }] };
    }
    if (sql.includes('INSERT INTO platform_audit_logs')) {
      return { rows: [{ id: 99, action: params[3], old_values: null, new_values: JSON.parse(params[5] || 'null'), created_at: '2026-11-12T10:00:00Z', target_store_id: params[1], target_user_id: params[2] }] };
    }
    if (sql.includes('generate_series')) {
      return { rows: [{ month: '2026-10', signups: 3, first_payments: 1 }, { month: '2026-11', signups: 5, first_payments: 2 }] };
    }
    if (sql.includes("to_char(date_trunc('month'")) {
      return { rows: [{ month: '2026-11', currency: 'NGN', payment_count: 2, total_amount: '40000' }] };
    }
    return { rows: [] };
  });
});

afterEach(() => vi.clearAllMocks());

describe('platform administration authorization', () => {
  test('does not treat a store admin as a platform admin', async () => {
    isPlatformAdmin = false;
    const server = await startServer();
    try {
      const response = await fetch(`${server.baseUrl}/platform/me`, { headers: authHeaders() });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Platform access required' });
    } finally {
      server.close();
    }
  });

  test('allows a separately granted platform admin', async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.baseUrl}/platform/me`, { headers: authHeaders() });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.platform_admin).toBe(true);
      expect(body.user.email).toBe(currentUser.email);
    } finally {
      server.close();
    }
  });

  test('can disable a customer account and revoke its refresh sessions', async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.baseUrl}/platform/users/${targetUser.id}/access`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.is_active).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [targetUser.id]
      );
      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO platform_audit_logs'))).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalledOnce();
    } finally {
      server.close();
    }
  });

  test('cannot change another platform owner through customer access controls', async () => {
    targetUser.is_platform_admin = true;
    const server = await startServer();
    try {
      const response = await fetch(`${server.baseUrl}/platform/users/${targetUser.id}/access`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/cannot be changed/i);
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
    } finally {
      server.close();
    }
  });
});

function post(server, path, body) {
  return fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('platform growth tools', () => {
  test('reports monthly sign-ups, first payments and revenue', async () => {
    const server = await startServer();
    try {
      const response = await fetch(`${server.baseUrl}/platform/trends?months=2`, { headers: authHeaders() });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.months).toEqual([
        { month: '2026-10', signups: 3, first_payments: 1, revenue: [] },
        { month: '2026-11', signups: 5, first_payments: 2, revenue: [{ currency: 'NGN', count: 2, amount: 40000 }] },
      ]);
    } finally {
      server.close();
    }
  });

  test('extends access without marking the activation fee as paid, and logs it', async () => {
    const server = await startServer();
    try {
      const response = await post(server, '/platform/stores/8/extend', { days: 30, reason: 'Support goodwill' });
      expect(response.status).toBe(200);
      expect((await response.json()).subscription.status).toBe('active');
      const sqls = mockQuery.mock.calls.map(([sql]) => String(sql));
      expect(sqls.some((sql) => sql.includes('activation_fee_paid'))).toBe(false);
      const audit = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO platform_audit_logs'));
      expect(audit[1][3]).toBe('subscription_extended');
      expect(JSON.parse(audit[1][5])).toMatchObject({ days: 30, reason: 'Support goodwill' });
      expect(mockQuery).toHaveBeenCalledWith('COMMIT');
    } finally {
      server.close();
    }
  });

  test('refuses to extend a store that already has permanent access', async () => {
    subscription.status = 'grandfathered';
    const server = await startServer();
    try {
      const response = await post(server, '/platform/stores/8/extend', { days: 30, reason: 'Support goodwill' });
      expect(response.status).toBe(400);
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
    } finally {
      server.close();
    }
  });

  test('validates the extension length', async () => {
    const server = await startServer();
    try {
      const response = await post(server, '/platform/stores/8/extend', { days: 0, reason: 'x' });
      expect(response.status).toBe(400);
    } finally {
      server.close();
    }
  });

  test('saves a store note in the audit log', async () => {
    const server = await startServer();
    try {
      const response = await post(server, '/platform/stores/8/notes', { note: '  Called the owner about setup  ' });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.note.new_values).toEqual({ note: 'Called the owner about setup' });
      expect(body.note.actor_email).toBe(currentUser.email);
      const missing = await post(server, '/platform/stores/404/notes', { note: 'Hello' });
      expect(missing.status).toBe(404);
    } finally {
      server.close();
    }
  });

  test('resends the welcome email with an hourly manual key', async () => {
    const server = await startServer();
    try {
      const response = await post(server, '/platform/stores/8/emails', { type: 'welcome' });
      expect(response.status).toBe(200);
      expect(mockSendWelcomeEmail).toHaveBeenCalledWith(expect.objectContaining({
        storeId: 8,
        to: 'ada@example.com',
        notificationKey: expect.stringMatching(/^manual:\d{4}-\d{2}-\d{2}T\d{2}$/),
      }));
    } finally {
      server.close();
    }
  });

  test('explains when a resend was blocked as a duplicate', async () => {
    mockSendActivationReminder.mockResolvedValue({ skipped: true, duplicate: true });
    const server = await startServer();
    try {
      const response = await post(server, '/platform/stores/8/emails', { type: 'activation_reminder' });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/last hour/);
      expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO platform_audit_logs'))).toBe(false);
    } finally {
      server.close();
    }
  });
});
