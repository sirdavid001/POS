import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET all customers
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM customers WHERE store_id = $1';
    const params = [req.user.store_id];
    let idx = 2;

    if (search) {
      sql += ` AND (name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }

    sql += ` ORDER BY name LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    const countResult = await query('SELECT COUNT(*) FROM customers WHERE store_id = $1', [req.user.store_id]);

    res.json({ customers: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) { next(err); }
});

// GET single customer + order history
router.get('/:id', async (req, res, next) => {
  try {
    const custResult = await query('SELECT * FROM customers WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
    if (custResult.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const ordersResult = await query(
      'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    );

    res.json({ customer: custResult.rows[0], orders: ordersResult.rows });
  } catch (err) { next(err); }
});

// POST create customer
router.post('/', async (req, res, next) => {
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
router.patch('/:id', async (req, res, next) => {
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
router.delete('/:id', async (req, res, next) => {
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
