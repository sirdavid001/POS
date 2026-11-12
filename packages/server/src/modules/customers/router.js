import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import { validate } from '../../middleware/validate.js';
import { createCustomerSchema, updateCustomerSchema } from './schema.js';
import { pagination } from '../../utils/pagination.js';

const router = Router();
router.use(authenticate);

// Fixed ORDER BY clauses; the query string only picks one, it is never interpolated.
const CUSTOMER_SORTS = {
  name: 'c.name ASC',
  spent: 'total_spent DESC, c.name ASC',
  recent: 's.last_visit DESC NULLS LAST, c.name ASC',
};
router.use(requireActiveSubscription());

// GET all customers
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const { limit, offset } = pagination(req.query);
    const order = CUSTOMER_SORTS[req.query.sort] || CUSTOMER_SORTS.name;

    // Lifetime totals from completed sales, so owners can find their best customers.
    let sql = `SELECT c.*, COALESCE(s.order_count, 0) AS order_count,
                      COALESCE(s.total_spent, 0) AS total_spent, s.last_visit
               FROM customers c
               LEFT JOIN LATERAL (
                 SELECT COUNT(*) AS order_count, SUM(o.total) AS total_spent, MAX(o.created_at) AS last_visit
                 FROM orders o
                 WHERE o.customer_id = c.id AND o.store_id = c.store_id AND o.status = 'completed'
               ) s ON true
               WHERE c.store_id = $1`;
    const params = [req.user.store_id];
    let idx = 2;

    if (search) {
      sql += ` AND (c.name ILIKE $${idx} OR c.email ILIKE $${idx} OR c.phone ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }

    sql += ` ORDER BY ${order} LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    let countSql = 'SELECT COUNT(*) FROM customers WHERE store_id = $1';
    const countParams = [req.user.store_id];
    if (search) {
      countSql += ' AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)';
      countParams.push(`%${search}%`);
    }
    const countResult = await query(countSql, countParams);

    res.json({ customers: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) { next(err); }
});

// GET single customer + order history
router.get('/:id', async (req, res, next) => {
  try {
    const custResult = await query('SELECT * FROM customers WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
    if (custResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const [ordersResult, statsResult, favouritesResult] = await Promise.all([
      query(
        'SELECT * FROM orders WHERE customer_id = $1 AND store_id = $2 ORDER BY created_at DESC LIMIT 20',
        [req.params.id, req.user.store_id]
      ),
      query(
        `SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total_spent,
                MIN(created_at) AS first_visit, MAX(created_at) AS last_visit
         FROM orders WHERE customer_id = $1 AND store_id = $2 AND status = 'completed'`,
        [req.params.id, req.user.store_id]
      ),
      query(
        `SELECT oi.product_name, SUM(oi.quantity) AS quantity, SUM(oi.total) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
         WHERE o.customer_id = $1 AND o.store_id = $2 AND o.status = 'completed'
         GROUP BY oi.product_name
         ORDER BY quantity DESC
         LIMIT 5`,
        [req.params.id, req.user.store_id]
      ),
    ]);

    res.json({
      customer: custResult.rows[0],
      orders: ordersResult.rows,
      stats: statsResult.rows[0],
      favourite_products: favouritesResult.rows,
    });
  } catch (err) { next(err); }
});

// POST create customer
router.post('/', validate(createCustomerSchema), async (req, res, next) => {
  try {
    const { name, email, phone, address, notes } = req.body;
    const result = await query(
      'INSERT INTO customers (store_id, name, email, phone, address, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.store_id, name, email || null, phone || null, address || null, notes || null]
    );
    res.status(201).json({ customer: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH update customer
router.patch('/:id', authorize('admin', 'manager'), validate(updateCustomerSchema), async (req, res, next) => {
  try {
    const { name, email, phone, address, notes, loyalty_points } = req.body;
    const result = await query(
      `UPDATE customers SET name = COALESCE($1,name), email = COALESCE($2,email),
       phone = COALESCE($3,phone), address = COALESCE($4,address), notes = COALESCE($5,notes),
       loyalty_points = COALESCE($6,loyalty_points), updated_at = NOW()
       WHERE id = $7 AND store_id = $8 RETURNING *`,
      [name, email, phone, address, notes, loyalty_points, req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ customer: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE customer
router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM customers WHERE id = $1 AND store_id = $2 RETURNING id',
      [req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ message: 'Customer deleted' });
  } catch (err) { next(err); }
});

export default router;
