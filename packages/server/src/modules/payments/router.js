import { Router } from 'express';
import axios from 'axios';
import { query } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

// Initialize Paystack transaction
router.post('/paystack/initialize', async (req, res, next) => {
  try {
    const { email, amount, order_id, callback_url } = req.body;

    if (!config.paystack.secretKey) {
      return res.status(500).json({ error: 'Paystack is not configured' });
    }

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: Math.round(amount * 100), // Paystack expects kobo
        callback_url: callback_url || `${config.corsOrigin}/payment/verify`,
        metadata: { order_id, store_id: req.user.store_id },
      },
      {
        headers: {
          Authorization: `Bearer ${config.paystack.secretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(`Paystack transaction initialized for order ${order_id}`);
    res.json({ data: response.data.data });
  } catch (err) {
    logger.error('Paystack initialization failed', err.response?.data || err.message);
    next(err);
  }
});

// Verify Paystack transaction
router.get('/paystack/verify/:reference', async (req, res, next) => {
  try {
    const { reference } = req.params;

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${config.paystack.secretKey}` },
      }
    );

    const data = response.data.data;

    if (data.status === 'success') {
      // Update payment record
      await query(
        `UPDATE payments SET status = 'success', reference = $1, metadata = $2
         WHERE order_id = $3 AND store_id = $4`,
        [reference, JSON.stringify(data), data.metadata?.order_id, req.user.store_id]
      );

      logger.info(`Payment verified: ${reference}`);
      res.json({ status: 'success', data });
    } else {
      res.json({ status: data.status, data });
    }
  } catch (err) {
    logger.error('Paystack verification failed', err.response?.data || err.message);
    next(err);
  }
});

// Record manual/cash payment
router.post('/record', async (req, res, next) => {
  try {
    const { order_id, amount, method, reference } = req.body;

    if (!['cash', 'card', 'transfer'].includes(method)) {
      return res.status(400).json({ error: 'Unsupported payment method' });
    }
    if (method !== 'cash' && !reference?.trim()) {
      return res.status(400).json({ error: 'A payment reference is required for card and transfer payments' });
    }
    const order = await query(
      'SELECT id, total FROM orders WHERE id = $1 AND store_id = $2',
      [order_id, req.user.store_id]
    );
    if (!order.rows[0]) return res.status(404).json({ error: 'Order not found' });
    if (Math.abs(Number(amount) - Number(order.rows[0].total)) > 0.009) {
      return res.status(400).json({ error: 'Payment amount must match the order total' });
    }

    const result = await query(
      `INSERT INTO payments (order_id, store_id, amount, method, provider, reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,'success') RETURNING *`,
      [order_id, req.user.store_id, amount, method, method === 'cash' ? 'cash' : 'manual', reference?.trim() || null]
    );

    res.status(201).json({ payment: result.rows[0] });
  } catch (err) { next(err); }
});

export default router;
