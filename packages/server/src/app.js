import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import config from './config/index.js';
import logger from './config/logger.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

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

const app = express();
const server = createServer(app);

// ---- Middleware ----
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts' },
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- Error handlers ----
app.use(notFound);
app.use(errorHandler);

// ---- WebSocket ----
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = Date.now().toString(36);
  wsClients.set(clientId, ws);
  logger.info(`WebSocket client connected: ${clientId}`);

  ws.on('close', () => {
    wsClients.delete(clientId);
    logger.info(`WebSocket client disconnected: ${clientId}`);
  });

  ws.on('error', (err) => {
    logger.error('WebSocket error', err);
  });
});

// Broadcast to all connected clients
export function broadcast(event, data) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  wsClients.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  });
}

// ---- Start server (local dev only) ----
if (process.env.VERCEL !== '1') {
  server.listen(config.port, () => {
    logger.info(`🚀 POS Server running on port ${config.port} (${config.nodeEnv})`);
    logger.info(`   API: http://localhost:${config.port}/api/v1`);
    logger.info(`   WS:  ws://localhost:${config.port}/ws`);
  });
}

export default app;
