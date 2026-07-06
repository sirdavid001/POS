import { Router } from 'express';
import { getClient, query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import logger from '../../config/logger.js';
import { broadcast } from '../../app.js';
import { validate } from '../../middleware/validate.js';
import { createOrderSchema } from './schema.js';

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
    } = req.body;

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

    if (client_order_id) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${req.user.store_id}:${client_order_id}`,
      ]);
      const existingOrder = await client.query(
        'SELECT * FROM orders WHERE store_id = $1 AND client_order_id = $2',
        [req.user.store_id, client_order_id]
      );
      if (existingOrder.rows[0]) {
        const existingItems = await client.query(
          'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
          [existingOrder.rows[0].id]
        );
        const existingPayment = await client.query(
          'SELECT reference FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1',
          [existingOrder.rows[0].id]
        );
        await client.query('COMMIT');
        return res.json({
          order: {
            ...existingOrder.rows[0],
            items: existingItems.rows,
            payment_reference: existingPayment.rows[0]?.reference || null,
          },
          idempotent: true,
        });
      }
    }

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
      const itemTotal = (parseFloat(product.price) * item.quantity) - itemDiscount;
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
        [product.id, req.user.store_id, req.user.id, item.quantity]
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
        total, status, payment_method, notes, paid_at, client_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10,NOW(),$11) RETURNING *`,
      [req.user.store_id, req.user.id, customer_id || null, orderNumber, subtotal, taxAmount,
       orderDiscount, total, payment_method, notes || null, client_order_id || null]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, discount, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.id, item.product_id, item.product_name, item.quantity, item.unit_price, item.discount, item.total]
      );
    }

    // Record payment
    await client.query(
      `INSERT INTO payments (order_id, store_id, amount, method, provider, reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,'success')`,
      [order.id, req.user.store_id, total, payment_method,
       payment_method === 'cash' ? 'cash' : 'manual', payment_reference?.trim() || null]
    );

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (store_id, user_id, entity_type, entity_id, action, new_values)
       VALUES ($1,$2,'order',$3,'create',$4)`,
      [req.user.store_id, req.user.id, order.id, JSON.stringify({ order_number: orderNumber, total, items: orderItems.length })]
    );

    await client.query('COMMIT');
    logger.info(`Order ${orderNumber} created by user ${req.user.id}, total: ${total}`);

    // Broadcast event to connected clients (like Dashboard)
    broadcast('NEW_ORDER', {
      order_number: orderNumber,
      total,
      cashier_id: req.user.id
    });

    res.status(201).json({
      order: { ...order, items: orderItems, payment_reference: payment_reference?.trim() || null },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET orders (paginated)
router.get('/', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, start_date, end_date } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT o.*, u.name as cashier_name, c.name as customer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN customers c ON o.customer_id = c.id
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

    const countResult = await query('SELECT COUNT(*) FROM orders WHERE store_id = $1', [req.user.store_id]);

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
    });
  } catch (err) { next(err); }
});

// GET single order with items
router.get('/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const orderResult = await query(
      `SELECT o.*, u.name as cashier_name, c.name as customer_name
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1 AND o.store_id = $2`,
      [req.params.id, req.user.store_id]
    );
    if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    const itemsResult = await query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [req.params.id]
    );

    const paymentResult = await query(
      'SELECT * FROM payments WHERE order_id = $1',
      [req.params.id]
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

export default router;
