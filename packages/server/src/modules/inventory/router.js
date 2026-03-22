import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

// POST adjust stock
router.post('/adjust', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { product_id, type, quantity, reason, supplier_id } = req.body;

    if (!['in', 'out', 'adjustment'].includes(type)) {
      return res.status(400).json({ error: 'Type must be in, out, or adjustment' });
    }

    const modifier = type === 'out' ? -quantity : quantity;

    await query(
      'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2 AND store_id = $3',
      [modifier, product_id, req.user.store_id]
    );

    const logResult = await query(
      `INSERT INTO inventory_logs (product_id, store_id, user_id, type, quantity, reason, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [product_id, req.user.store_id, req.user.id, type, quantity, reason || null, supplier_id || null]
    );

    res.status(201).json({ log: logResult.rows[0] });
  } catch (err) { next(err); }
});

// GET inventory logs
router.get('/logs', async (req, res, next) => {
  try {
    const { page = 1, limit = 50, product_id } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT il.*, p.name as product_name, u.name as user_name, s.name as supplier_name
      FROM inventory_logs il
      JOIN products p ON il.product_id = p.id
      LEFT JOIN users u ON il.user_id = u.id
      LEFT JOIN suppliers s ON il.supplier_id = s.id
      WHERE il.store_id = $1
    `;
    const params = [req.user.store_id];
    let idx = 2;

    if (product_id) { sql += ` AND il.product_id = $${idx}`; params.push(product_id); idx++; }
    sql += ` ORDER BY il.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    res.json({ logs: result.rows });
  } catch (err) { next(err); }
});

// ---- Supplier CRUD ----
router.get('/suppliers', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM suppliers WHERE store_id = $1 ORDER BY name', [req.user.store_id]);
    res.json({ suppliers: result.rows });
  } catch (err) { next(err); }
});

router.post('/suppliers', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, contact_name, email, phone, address } = req.body;
    const result = await query(
      'INSERT INTO suppliers (store_id, name, contact_name, email, phone, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.store_id, name, contact_name || null, email || null, phone || null, address || null]
    );
    res.status(201).json({ supplier: result.rows[0] });
  } catch (err) { next(err); }
});

router.patch('/suppliers/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, contact_name, email, phone, address } = req.body;
    const result = await query(
      `UPDATE suppliers SET name = COALESCE($1,name), contact_name = COALESCE($2,contact_name),
       email = COALESCE($3,email), phone = COALESCE($4,phone), address = COALESCE($5,address), updated_at = NOW()
       WHERE id = $6 AND store_id = $7 RETURNING *`,
      [name, contact_name, email, phone, address, req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ supplier: result.rows[0] });
  } catch (err) { next(err); }
});

router.delete('/suppliers/:id', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM suppliers WHERE id = $1 AND store_id = $2 RETURNING id',
      [req.params.id, req.user.store_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deleted' });
  } catch (err) { next(err); }
});

// ---- Purchase Orders ----
router.get('/purchase-orders', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT po.*, s.name as supplier_name, u.name as created_by
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN users u ON po.user_id = u.id
       WHERE po.store_id = $1 ORDER BY po.created_at DESC`,
      [req.user.store_id]
    );
    res.json({ purchaseOrders: result.rows });
  } catch (err) { next(err); }
});

router.post('/purchase-orders', authorize('admin', 'manager'), async (req, res, next) => {
  try {
    const { supplier_id, items, notes } = req.body;
    let total = 0;
    if (items) items.forEach(i => { total += i.quantity * i.unit_cost; });

    const poResult = await query(
      `INSERT INTO purchase_orders (store_id, supplier_id, user_id, total, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.store_id, supplier_id, req.user.id, total, notes || null]
    );

    if (items && items.length > 0) {
      for (const item of items) {
        await query(
          'INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)',
          [poResult.rows[0].id, item.product_id, item.quantity, item.unit_cost]
        );
      }
    }

    res.status(201).json({ purchaseOrder: poResult.rows[0] });
  } catch (err) { next(err); }
});

export default router;
