import { Router } from 'express';
import { getClient, query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import logger from '../../config/logger.js';
import { broadcast } from '../../app.js';
import { validate } from '../../middleware/validate.js';
import { createOrderSchema, refundOrderSchema } from './schema.js';
import { refundOrder, RefundError } from './refund.js';
import { pagination } from '../../utils/pagination.js';
import { RegisterError, audit, loadSession, presentRegisterBasket, presentSession, registerPolicy, requireMatchingBasket } from '../register-control/service.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

// Generate unique order number
function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

// POST create order (checkout)
router.post('/', validate(createOrderSchema), async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const {
      items,
      customer_id,
      payment_method = 'cash',
      payment_reference,
      discount_amount = 0,
      notes,
      client_order_id,
      register_session_id,
      register_revision,
    } = req.body;
    const badgeMode = req.subscription?.paid_staff_tools && await registerPolicy(client, req.user.store_id);

    if (!Array.isArray(items) || items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Order must have at least one item' });
    }
    if (!['cash', 'card', 'transfer'].includes(payment_method)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Unsupported payment method' });
    }
    if (payment_method !== 'cash' && !payment_reference?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A payment reference is required for card and transfer sales' });
    }
    if (!items.every((item) => Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Every order item must have a positive whole-number quantity' });
    }

    if (customer_id) {
      const customer = await client.query(
        'SELECT id FROM customers WHERE id = $1 AND store_id = $2 FOR SHARE',
        [customer_id, req.user.store_id]
      );
      if (!customer.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Customer does not belong to this store' });
      }
    }

    if (client_order_id) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${req.user.store_id}:${client_order_id}`,
      ]);
      const existingOrder = await client.query(
        'SELECT * FROM orders WHERE store_id = $1 AND client_order_id = $2',
        [req.user.store_id, client_order_id]
      );
      if (existingOrder.rows[0]) {
        const previous = existingOrder.rows[0];
        let currentRegister = null;
        if (previous.register_session_id) {
          if (previous.register_session_id !== register_session_id) {
            throw new RegisterError(409, 'That sale belongs to another register session.', 'SALE_SESSION_MISMATCH');
          }
          // Replaying a completed sale never repeats payment, stock or audit writes.
          currentRegister = await loadSession(client, req.user, register_session_id);
        } else if (previous.user_id !== req.user.id || register_session_id) {
          throw new RegisterError(409, 'That sale belongs to another checkout.', 'SALE_SESSION_MISMATCH');
        }
        const existingItems = await client.query(
          'SELECT * FROM order_items WHERE order_id = $1 AND store_id = $2 ORDER BY id',
          [existingOrder.rows[0].id, req.user.store_id]
        );
        const existingPayment = await client.query(
          'SELECT reference FROM payments WHERE order_id = $1 AND store_id = $2 ORDER BY id DESC LIMIT 1',
          [existingOrder.rows[0].id, req.user.store_id]
        );
        const registerView = currentRegister
          ? await presentRegisterBasket(client, req.user.store_id, presentSession(currentRegister)) : null;
        await client.query('COMMIT');
        return res.json({
          order: {
            ...existingOrder.rows[0],
            items: existingItems.rows,
            cashier_name: currentRegister?.cashier_name || req.user.name,
            payment_reference: existingPayment.rows[0]?.reference || null,
          },
          idempotent: true,
          ...(registerView ? { register_session: registerView } : {}),
        });
      }
    }

    if (!badgeMode && register_session_id) {
      throw new RegisterError(409, 'Badge checkout is no longer enabled. Reopen the terminal.', 'BADGE_MODE_DISABLED');
    }
    const registerSession = badgeMode ? await loadSession(client, req.user, register_session_id) : null;
    if (registerSession) requireMatchingBasket(registerSession, items, register_revision);
    const cashier = registerSession
      ? { ...req.user, id: registerSession.cashier_id, name: registerSession.cashier_name, role: registerSession.cashier_role }
      : req.user;

    // Get store tax rate
    const storeResult = await client.query('SELECT tax_rate FROM stores WHERE id = $1', [req.user.store_id]);
    const taxRate = parseFloat(storeResult.rows[0]?.tax_rate || 0);

    let subtotal = 0;
    const orderItems = [];

    // Validate items and calculate totals
    for (const item of items) {
      const productResult = await client.query(
        `SELECT id, name, price, stock_quantity
         FROM products
         WHERE id = $1 AND store_id = $2 AND is_active = true
         FOR UPDATE`,
        [item.product_id, req.user.store_id]
      );

      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product ID ${item.product_id} not found or inactive` });
      }

      const product = productResult.rows[0];

      if (product.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}`
        });
      }

      const itemDiscount = Math.max(0, Number(item.discount || 0));
      const lineAmount = parseFloat(product.price) * item.quantity;
      if (itemDiscount > lineAmount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Discount cannot exceed the price of ${product.name}` });
      }
      const itemTotal = lineAmount - itemDiscount;
      subtotal += itemTotal;

      orderItems.push({
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: product.price,
        discount: itemDiscount,
        total: itemTotal,
      });

      // Deduct stock
      await client.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2',
        [item.quantity, product.id]
      );

      // Log inventory change
      await client.query(
        `INSERT INTO inventory_logs (product_id, store_id, user_id, type, quantity, reason)
         VALUES ($1, $2, $3, 'out', $4, 'Sale')`,
        [product.id, req.user.store_id, cashier.id, item.quantity]
      );
    }

    const orderDiscount = Math.max(0, Number(discount_amount || 0));
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount - orderDiscount;
    if (total < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Discount cannot exceed the order amount' });
    }
    const orderNumber = generateOrderNumber();

    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders
       (store_id, user_id, customer_id, order_number, subtotal, tax_amount, discount_amount,
        total, status, payment_method, notes, paid_at, client_order_id, register_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,NOW(),$11,$12) RETURNING *`,
      [req.user.store_id, cashier.id, customer_id || null, orderNumber, subtotal, taxAmount,
       orderDiscount, total, payment_method, notes || null, client_order_id || null, register_session_id || null]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, store_id, product_name, quantity, unit_price, discount, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [order.id, item.product_id, req.user.store_id, item.product_name, item.quantity, item.unit_price, item.discount, item.total]
      );
    }

    // Record payment
    await client.query(
      `INSERT INTO payments (order_id, store_id, amount, method, provider, reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,'success')`,
      [order.id, req.user.store_id, total, payment_method,
       payment_method === 'cash' ? 'cash' : 'manual', payment_reference?.trim() || null]
    );

    await audit(client, cashier, 'order', order.id, 'create', {
      order_number: orderNumber, total, items: orderItems.length, terminal_user_id: req.user.id,
    });
    let registerView = null;
    if (registerSession) {
      const { rows: [updated] } = await client.query(
        `UPDATE register_sessions SET cart = '[]'::jsonb, revision = revision + 1
         WHERE id = $1 AND store_id = $2 RETURNING *`, [registerSession.id, req.user.store_id]
      );
      registerView = presentSession({ ...updated, cashier_name: cashier.name });
    }

    await client.query('COMMIT');
    logger.info(`Order ${orderNumber} created by user ${cashier.id}, total: ${total}`);

    // Broadcast event to connected clients (like Dashboard)
    broadcast('NEW_ORDER', {
      order_number: orderNumber,
      total,
      cashier_id: cashier.id
    }, req.user.store_id);

    res.status(201).json({
      order: { ...order, items: orderItems, cashier_name: cashier.name, payment_reference: payment_reference?.trim() || null },
      ...(registerView ? { register_session: registerView } : {}),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof RegisterError) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  } finally {
    client.release();
  }
});

// GET orders (paginated)
router.get('/', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { status, start_date, end_date } = req.query;
    const { page, limit, offset } = pagination(req.query, { defaultLimit: 20 });

    let sql = `
      SELECT o.*, u.name as cashier_name, c.name as customer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id AND u.store_id = o.store_id
      LEFT JOIN customers c ON o.customer_id = c.id AND c.store_id = o.store_id
      WHERE o.store_id = $1
    `;
    const params = [req.user.store_id];
    let idx = 2;

    if (status) { sql += ` AND o.status = $${idx}`; params.push(status); idx++; }
    if (start_date) { sql += ` AND o.created_at >= $${idx}`; params.push(start_date); idx++; }
    if (end_date) { sql += ` AND o.created_at <= $${idx}`; params.push(end_date); idx++; }

    sql += ` ORDER BY o.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    let countSql = 'SELECT COUNT(*) FROM orders WHERE store_id = $1';
    const countParams = [req.user.store_id];
    let countIdx = 2;
    if (status) { countSql += ` AND status = $${countIdx}`; countParams.push(status); countIdx++; }
    if (start_date) { countSql += ` AND created_at >= $${countIdx}`; countParams.push(start_date); countIdx++; }
    if (end_date) { countSql += ` AND created_at <= $${countIdx}`; countParams.push(end_date); }
    const countResult = await query(countSql, countParams);

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
    });
  } catch (err) { next(err); }
});

// GET single order with items
router.get('/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const orderResult = await query(
      `SELECT o.*, u.name as cashier_name, c.name as customer_name
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id AND u.store_id = o.store_id
       LEFT JOIN customers c ON o.customer_id = c.id AND c.store_id = o.store_id
       WHERE o.id = $1 AND o.store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    const itemsResult = await query(
      'SELECT * FROM order_items WHERE order_id = $1 AND store_id = $2',
      [req.params.id, req.user.store_id]
    );

    const paymentResult = await query(
      'SELECT * FROM payments WHERE order_id = $1 AND store_id = $2',
      [req.params.id, req.user.store_id]
    );

    res.json({
      order: {
        ...orderResult.rows[0],
        items: itemsResult.rows,
        payments: paymentResult.rows,
      },
    });
  } catch (err) { next(err); }
});

// POST full refund of a completed sale (managers and admins)
router.post('/:id/refund', authorize('admin', 'manager'), validate(refundOrderSchema), async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await refundOrder(client, {
      orderId: req.params.id,
      storeId: req.user.store_id,
      userId: req.user.id,
      reason: req.body.reason,
      restock: req.body.restock,
    });
    await client.query('COMMIT');
    logger.info(`Order ${result.order.order_number} refunded by user ${req.user.id}`);
    broadcast('ORDER_REFUNDED', {
      order_number: result.order.order_number,
      total: result.refund.amount,
    }, req.user.store_id);
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof RefundError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

export default router;
