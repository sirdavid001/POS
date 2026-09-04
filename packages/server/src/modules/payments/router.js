import { Router } from 'express';
import { getClient } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import { validate } from '../../middleware/validate.js';
import { recordPaymentSchema } from './schema.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

// Record manual/cash payment
router.post('/record', validate(recordPaymentSchema), async (req, res, next) => {
  let client;
  try {
    const { order_id, amount, method, reference } = req.body;
    client = await getClient();
    await client.query('BEGIN');

    const order = await client.query(
      'SELECT id, total FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [order_id, req.user.store_id]
    );
    if (!order.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (Math.abs(Number(amount) - Number(order.rows[0].total)) > 0.009) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment amount must match the order total' });
    }

    const existing = await client.query(
      "SELECT id FROM payments WHERE order_id = $1 AND store_id = $2 AND status = 'success' LIMIT 1",
      [order_id, req.user.store_id]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This order already has a successful payment' });
    }

    const result = await client.query(
      `INSERT INTO payments (order_id, store_id, amount, method, provider, reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,'success') RETURNING *`,
      [order_id, req.user.store_id, amount, method, method === 'cash' ? 'cash' : 'manual', reference?.trim() || null]
    );
    await client.query('COMMIT');

    res.status(201).json({ payment: result.rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    next(err);
  } finally {
    client?.release();
  }
});

export default router;
