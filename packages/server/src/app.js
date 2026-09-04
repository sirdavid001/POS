import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';

import config from './config/index.js';
import logger from './config/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { PostgresRateLimitStore } from './middleware/postgres-rate-limit-store.js';

// Route imports
import authRouter from './modules/auth/router.js';
import productsRouter from './modules/products/router.js';
import categoriesRouter from './modules/categories/router.js';
import ordersRouter from './modules/orders/router.js';
import inventoryRouter from './modules/inventory/router.js';
import customersRouter from './modules/customers/router.js';
import paymentsRouter from './modules/payments/router.js';
import reportsRouter from './modules/reports/router.js';
import settingsRouter from './modules/settings/router.js';
import billingRouter from './modules/billing/router.js';
import jobsRouter from './modules/jobs/router.js';
import accountRouter from './modules/account/router.js';
import downloadsRouter from './modules/downloads/router.js';
import supportRouter from './modules/support/router.js';
import syncRouter from './modules/sync/router.js';
import { query } from './config/database.js';

const app = express();
const isVercel = process.env.VERCEL === '1';
const server = isVercel ? null : createServer(app);

// ---- Middleware ----
if (isVercel) {
  app.set('trust proxy', 1);
}
app.use(helmet());
const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    const error = new Error('Origin not allowed');
    error.statusCode = 403;
    callback(error);
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
};
app.use(cors(corsOptions));
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => {
    req.rawBody = buffer;
  },
}));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  legacyHeaders: false,
  standardHeaders: 'draft-8',
  store: new PostgresRateLimitStore('api'),
  skip: (req) =>
    req.originalUrl === '/api/health' ||
    req.originalUrl.startsWith('/api/v1/billing/webhooks/'),
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  legacyHeaders: false,
  standardHeaders: 'draft-8',
  store: new PostgresRateLimitStore('auth'),
  message: { error: 'Too many authentication attempts' },
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);
app.use('/api/v1/auth/reset-password', authLimiter);

// ---- API Routes ----
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/billing', billingRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/account', accountRouter);
app.use('/api/v1/downloads', downloadsRouter);
app.use('/api/v1/support', supportRouter);
app.use('/api/v1/sync', syncRouter);

const getHealthPayload = (overrides = {}) => ({
  status: 'ok',
  service: 'pos-server',
  timestamp: new Date().toISOString(),
  ...overrides,
});

app.get('/', (req, res) => {
  res.json({
    ...getHealthPayload(),
    apiBase: '/api/v1',
    health: '/api/health',
    databaseSource: config.db.source,
  });
});

async function handleHealth(req, res) {
  try {
    await query('SELECT 1');
    res.json(getHealthPayload({ database: 'ok', databaseSource: config.db.source }));
  } catch (err) {
    logger.error('Health check failed', {
      error: err.message,
      code: err.code,
      path: req.path,
      method: req.method,
      databaseSource: config.db.source,
    });
    res.status(503).json(getHealthPayload({ status: 'error', database: 'unavailable', databaseSource: config.db.source }));
  }
}

app.get('/health', handleHealth);
app.get('/api/health', handleHealth);

// ---- Error handlers ----
app.use(notFound);
app.use(errorHandler);

// ---- WebSocket ----
const wsClients = new Map();

async function authenticateWebSocket(request) {
  const protocols = String(request.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((protocol) => protocol.trim());
  if (protocols[0] !== 'quickpos-v1' || !protocols[1]) {
    throw new Error('Missing WebSocket credentials');
  }

  const decoded = jwt.verify(protocols[1], config.jwt.secret);
  const result = await query(
    `SELECT u.id, u.store_id
     FROM users u
     WHERE u.id = $1 AND u.store_id = $2 AND u.is_active = true`,
    [decoded.userId, decoded.storeId]
  );
  if (!result.rows[0]) throw new Error('Invalid WebSocket credentials');
  return result.rows[0];
}

if (server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, request) => {
    const clientId = Date.now().toString(36);
    try {
      const user = await authenticateWebSocket(request);
      wsClients.set(clientId, { ws, storeId: user.store_id });
      logger.info(`WebSocket client connected: ${clientId}`, { storeId: user.store_id });
    } catch (error) {
      logger.warn('Rejected unauthenticated WebSocket connection', { error: error.message });
      ws.close(1008, 'Authentication required');
      return;
    }

    ws.on('close', () => {
      wsClients.delete(clientId);
      logger.info(`WebSocket client disconnected: ${clientId}`);
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error', err);
    });
  });
}

// Broadcast to all connected clients
export function broadcast(event, data, storeId) {
  if (!storeId) {
    logger.warn('Skipped WebSocket broadcast without store scope', { event });
    return;
  }
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  wsClients.forEach(({ ws, storeId: clientStoreId }) => {
    if (String(clientStoreId) === String(storeId) && ws.readyState === 1) {
      ws.send(message);
    }
  });
}

// ---- Start server (local dev only) ----
if (server) {
  server.listen(config.port, () => {
    logger.info(`🚀 POS Server running on port ${config.port} (${config.nodeEnv})`);
    logger.info(`   API: http://localhost:${config.port}/api/v1`);
    logger.info(`   WS:  ws://localhost:${config.port}/ws`);
  });
}

export default app;
