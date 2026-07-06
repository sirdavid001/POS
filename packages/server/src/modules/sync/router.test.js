import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';

const mockQuery = jest.fn();
const mockGetStoreSubscription = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
}));

jest.unstable_mockModule('../billing/subscription.js', () => ({
  getStoreSubscription: mockGetStoreSubscription,
}));

const { default: syncRouter } = await import('./router.js');
const { default: config } = await import('../../config/index.js');

config.jwt.secret = 'sync-test-secret';
let currentUser;

function authHeader() {
  return `Bearer ${jwt.sign({ userId: currentUser.id }, config.jwt.secret, { expiresIn: '15m' })}`;
}

async function withServer(callback) {
  const app = express();
  app.use('/sync', syncRouter);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = await new Promise((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

beforeEach(() => {
  currentUser = { id: 3, store_id: 9, name: 'Owner', email: 'owner@example.com', role: 'admin', is_active: true };
  mockGetStoreSubscription.mockResolvedValue({ status: 'active', can_write: true });
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('FROM users u JOIN roles')) return { rows: [currentUser] };
    if (sql.includes('SELECT * FROM stores')) return { rows: [{ id: 9, name: 'Store', tax_rate: 7.5 }] };
    if (sql.includes('FROM products p')) return { rows: [{ id: 1, name: 'Rice', stock_quantity: 10 }] };
    if (sql.includes('FROM categories')) return { rows: [{ id: 2, name: 'Food' }] };
    if (sql.includes('FROM customers')) return { rows: [{ id: 4, name: 'Ada' }] };
    if (sql.includes('FROM suppliers')) return { rows: [{ id: 5, name: 'Supplier' }] };
    if (sql.includes('FROM orders o')) return { rows: [{ id: 6, order_number: 'ORD-1', items: [] }] };
    if (sql.includes('FROM inventory_logs')) return { rows: [{ id: 7, product_name: 'Rice' }] };
    if (sql.includes('SELECT u.id, u.name')) return { rows: [{ id: 3, name: 'Owner', role: 'admin' }] };
    return { rows: [] };
  });
});

describe('offline bootstrap snapshot', () => {
  test('requires an authenticated device', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sync/bootstrap`);
      expect(response.status).toBe(401);
    });
  });

  test('returns the complete offline working set for managers and admins', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sync/bootstrap`, {
        headers: { Authorization: authHeader() },
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.snapshot.store.name).toBe('Store');
      expect(payload.snapshot.products).toHaveLength(1);
      expect(payload.snapshot.customers).toHaveLength(1);
      expect(payload.snapshot.orders[0].order_number).toBe('ORD-1');
      expect(payload.snapshot.logs[0].product_name).toBe('Rice');
      expect(payload.snapshot.users[0].role).toBe('admin');
      expect(payload.synced_at).toBeTruthy();
    });
  });

  test('does not expose management history to cashier snapshots', async () => {
    currentUser = { ...currentUser, role: 'cashier' };
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sync/bootstrap`, {
        headers: { Authorization: authHeader() },
      });
      const payload = await response.json();
      expect(payload.snapshot.products).toHaveLength(1);
      expect(payload.snapshot.orders).toEqual([]);
      expect(payload.snapshot.logs).toEqual([]);
      expect(payload.snapshot.users).toEqual([]);
    });
  });
});
