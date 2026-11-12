import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockSend = vi.fn(async () => ({ data: { id: 'mail_1' } }));

vi.doMock('../../config/database.js', () => ({
  query: mockQuery,
  getClient: vi.fn(async () => ({ query: mockQuery, release: mockRelease })),
}));
vi.doMock('../billing/subscription.js', () => ({
  getStoreSubscription: vi.fn(async () => ({ status: 'expired', can_write: false })),
}));
vi.doMock('resend', () => ({ Resend: class { constructor() { this.emails = { send: mockSend }; } } }));

const { default: supportRouter } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

const jwtSecret = 'dev-secret-change-me';
config.jwt.secret = jwtSecret;
const user = { id: 5, email: 'ada@example.com', name: 'Ada', store_id: 8, is_active: true, role: 'cashier' };

let state;

async function call(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use('/support', supportRouter);
  app.use((error, req, res, _next) => res.status(500).json({ error: error.message }));
  const server = await new Promise((resolve) => { const created = app.listen(0, () => resolve(created)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt.sign({ userId: user.id, role: user.role, storeId: 8 }, jwtSecret)}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  state = { open: null, recent: 0, missing: false };
  config.email.resendApiKey = 'test-key';
  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (sql.includes('FROM users u JOIN roles') && sql.includes('WHERE u.id = $1')) return { rows: [user] };
    if (state.missing && (sql.includes('support_') || sql.includes('platform_announcements'))) {
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    }
    if (sql.includes("m.sender_type = 'store' AND m.created_at > NOW() - INTERVAL '1 minute'")) return { rows: [{ count: state.recent }] };
    if (sql.includes("WHERE store_id = $1 AND status = 'open' FOR UPDATE")) return { rows: state.open ? [state.open] : [] };
    if (sql.includes('INSERT INTO support_conversations')) return { rows: [{ id: 3, store_id: 8, status: 'open' }] };
    if (sql.includes('INSERT INTO support_messages')) return { rows: [{ id: 40, conversation_id: params[0], sender_type: 'store', body: params[2], created_at: '2026-11-12T10:00:00Z' }] };
    if (sql.includes('UPDATE support_conversations SET')) return { rows: [{ id: 3, store_id: 8, status: 'open', last_sender: 'store' }] };
    if (sql.includes('SELECT name FROM stores')) return { rows: [{ name: 'Ada Stores' }] };
    return { rows: [] };
  });
});

afterEach(() => vi.clearAllMocks());

describe('store live chat', () => {
  test('works for a store whose subscription has lapsed and starts a conversation', async () => {
    const response = await call('POST', '/support/chat/messages', { body: 'I paid by transfer, please activate' });
    expect(response.status).toBe(201);
    expect(response.body.message).toMatchObject({ id: 40, sender_type: 'store', sender_name: 'Ada' });
    expect(mockQuery).toHaveBeenCalledWith('COMMIT');
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledOnce());
  });

  test('does not email support again for an ongoing conversation', async () => {
    state.open = { id: 3, store_id: 8, status: 'open' };
    expect((await call('POST', '/support/chat/messages', { body: 'Any update?' })).status).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO support_conversations'))).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('slows down message floods', async () => {
    state.recent = 12;
    expect((await call('POST', '/support/chat/messages', { body: 'Hello' })).status).toBe(429);
  });

  test('rejects empty messages', async () => {
    expect((await call('POST', '/support/chat/messages', { body: '   ' })).status).toBe(400);
  });

  test('reports a needed database update instead of failing', async () => {
    state.missing = true;
    const response = await call('GET', '/support/chat');
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MIGRATION_REQUIRED');
    expect((await call('GET', '/support/chat/unread')).body).toMatchObject({ unread: 0, available: false });
    expect((await call('GET', '/support/announcements')).body).toEqual({ announcements: [] });
  });
});
