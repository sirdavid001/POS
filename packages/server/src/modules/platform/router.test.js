import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockGetStoreSubscription = vi.fn();

vi.doMock('../../config/database.js', () => ({
  query: mockQuery,
  getClient: vi.fn(async () => ({ query: mockQuery, release: mockRelease })),
}));

vi.doMock('../billing/subscription.js', () => ({
  getStoreSubscription: mockGetStoreSubscription,
}));

const { default: platformRouter } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

const jwtSecret = 'dev-secret-change-me';
config.jwt.secret = jwtSecret;

let isPlatformAdmin;
let currentUser;
let targetUser;

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
  mockGetStoreSubscription.mockResolvedValue({ status: 'active', can_write: true });
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
