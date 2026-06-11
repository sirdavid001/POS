import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
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

const { default: accountRouter } = await import('./router.js');
const { default: downloadsRouter } = await import('../downloads/router.js');
const { default: config } = await import('../../config/index.js');

const jwtSecret = 'dev-secret-change-me';
config.jwt.secret = jwtSecret;
const originalManifestUrl = config.downloads.manifestUrl;

const manifest = {
  schema_version: 1,
  version: '1.0.0',
  releases: [
    {
      platform: 'windows',
      architecture: 'x64',
      file_type: '.exe',
      version: '1.0.0',
      url: 'https://downloads.example/QuickPOS.exe',
      status: 'available',
    },
  ],
};

let currentUser;
let currentSubscription;
let store;
let emailConflict;

function tokenFor(user = currentUser) {
  return jwt.sign(
    { userId: user.id, role: user.role, storeId: user.store_id },
    jwtSecret,
    { expiresIn: '15m' }
  );
}

function authHeaders(user = currentUser) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.get('/release-source', (req, res) => res.json(manifest));
  app.use('/account', accountRouter);
  app.use('/downloads', downloadsRouter);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  const server = await new Promise((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  const address = server.address();
  server.baseUrl = `http://127.0.0.1:${address.port}`;
  config.downloads.manifestUrl = `${server.baseUrl}/release-source`;
  return server;
}

async function request(server, path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  return fetch(`${server.baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

beforeEach(() => {
  currentUser = {
    id: 10,
    email: 'owner@example.com',
    name: 'Store Owner',
    phone: '+2348000000000',
    store_id: 7,
    is_active: true,
    role: 'admin',
  };
  currentSubscription = {
    status: 'pending_activation',
    can_write: false,
    activation_required: true,
  };
  store = {
    id: 7,
    name: 'Example Store',
    email: 'store@example.com',
    phone: '+2348000000000',
    currency: 'NGN',
    tax_rate: '0.00',
  };
  emailConflict = false;

  mockGetStoreSubscription.mockImplementation(async () => currentSubscription);
  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (sql.includes('FROM users u JOIN roles')) {
      return { rows: [currentUser] };
    }
    if (sql.includes('SELECT * FROM stores WHERE id = $1')) {
      return { rows: [store] };
    }
    if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) {
      return { rows: emailConflict ? [{ id: 99 }] : [] };
    }
    if (sql.includes('UPDATE users SET')) {
      return {
        rows: [{
          id: currentUser.id,
          email: params.find((value) => typeof value === 'string' && value.includes('@')) || currentUser.email,
          name: params[0] || currentUser.name,
          phone: params.find((value) => typeof value === 'string' && value.startsWith('+')) || currentUser.phone,
          store_id: currentUser.store_id,
        }],
      };
    }
    if (sql.includes('UPDATE stores SET')) {
      store = {
        ...store,
        name: params[0] ?? store.name,
        address: params[1] ?? store.address,
        phone: params[2] ?? store.phone,
      };
      return { rows: [store] };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  config.downloads.manifestUrl = originalManifestUrl;
  jest.clearAllMocks();
});

describe('website account and download gates', () => {
  test('requires authentication for account overview', async () => {
    const server = await startServer();
    try {
      const response = await request(server, '/account/overview');
      expect(response.status).toBe(401);
    } finally {
      server.close();
    }
  });

  test('rejects non-admin users from the website account portal', async () => {
    currentUser = { ...currentUser, role: 'manager' };
    currentSubscription = { status: 'active', can_write: true, activation_required: false };
    const server = await startServer();
    try {
      const response = await request(server, '/account/overview', {
        headers: authHeaders(),
      });
      expect(response.status).toBe(403);
    } finally {
      server.close();
    }
  });

  test('allows a pending-activation admin to update profile and store setup', async () => {
    const server = await startServer();
    try {
      const profileResponse = await request(server, '/account/profile', {
        method: 'PATCH',
        headers: authHeaders(),
        body: {
          name: 'Updated Owner',
          email: 'updated@example.com',
          phone: '+2348111111111',
        },
      });
      expect(profileResponse.status).toBe(200);
      const profile = await profileResponse.json();
      expect(profile.user.role).toBe('admin');

      const storeResponse = await request(server, '/account/store', {
        method: 'PATCH',
        headers: authHeaders(),
        body: {
          name: 'Updated Store',
          address: '12 Market Road',
          currency: 'ngn',
        },
      });
      expect(storeResponse.status).toBe(200);
      const body = await storeResponse.json();
      expect(body.store.name).toBe('Updated Store');
    } finally {
      server.close();
    }
  });

  test('blocks pending-activation admins from the downloads manifest', async () => {
    const server = await startServer();
    try {
      const response = await request(server, '/downloads/manifest', {
        headers: authHeaders(),
      });
      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.code).toBe('INITIAL_ACTIVATION_REQUIRED');
    } finally {
      server.close();
    }
  });

  test('allows an active admin to fetch the downloads manifest', async () => {
    currentSubscription = {
      status: 'active',
      can_write: true,
      activation_required: false,
      current_period_end: '2026-12-31T23:59:59.000Z',
    };
    const server = await startServer();
    try {
      const response = await request(server, '/downloads/manifest', {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(manifest);
    } finally {
      server.close();
    }
  });
});
