import { Router } from 'express';
import { getClient, query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';
import { validate } from '../../middleware/validate.js';
import {
  adjustStockSchema,
  createPurchaseOrderSchema,
  createSupplierSchema,
  updateSupplierSchema,
} from './schema.js';
import { pagination } from '../../utils/pagination.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

// POST adjust stock
router.post('/adjust', authorize('admin', 'manager'), validate(adjustStockSchema), async (req, res, next) => {
  let client;
  try {
    const { product_id, type, quantity, reason, supplier_id } = req.body;
    const modifier = type === 'out' ? -quantity : quantity;
    client = await getClient();
    await client.query('BEGIN');

    const productResult = await client.query(
      'SELECT id, stock_quantity FROM products WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [product_id, req.user.store_id]
    );
    if (!productResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    if (supplier_id) {
      const supplier = await client.query(
        'SELECT id FROM suppliers WHERE id = $1 AND store_id = $2',
        [supplier_id, req.user.store_id]
      );
      if (!supplier.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Supplier does not belong to this store' });
      }
    }

    const nextStock = Number(productResult.rows[0].stock_quantity) + modifier;
    if (nextStock < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock adjustment cannot make inventory negative' });
    }

    await client.query(
      'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3',
      [nextStock, product_id, req.user.store_id]
    );

    const logResult = await client.query(
      `INSERT INTO inventory_logs (product_id, store_id, user_id, type, quantity, reason, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [product_id, req.user.store_id, req.user.id, type, quantity, reason || null, supplier_id || null]
    );
    await client.query('COMMIT');

    res.status(201).json({ log: logResult.rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    next(err);
  } finally {
    client?.release();
  }
});

// GET inventory logs
router.get('/logs', async (req, res, next) => {
  try {
    const { product_id } = req.query;
    const { limit, offset } = pagination(req.query);

    let sql = `
      SELECT il.*, COALESCE(p.name, 'Deleted product') as product_name,
             u.name as user_name, s.name as supplier_name
      FROM inventory_logs il
      LEFT JOIN products p ON il.product_id = p.id AND p.store_id = il.store_id
      LEFT JOIN users u ON il.user_id = u.id AND u.store_id = il.store_id
      LEFT JOIN suppliers s ON il.supplier_id = s.id AND s.store_id = il.store_id
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

router.post('/suppliers', authorize('admin', 'manager'), validate(createSupplierSchema), async (req, res, next) => {
  try {
    const { name, contact_name, email, phone, address } = req.body;
    const result = await query(
      'INSERT INTO suppliers (store_id, name, contact_name, email, phone, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.store_id, name, contact_name || null, email || null, phone || null, address || null]
    );
    res.status(201).json({ supplier: result.rows[0] });
  } catch (err) { next(err); }
});

router.patch('/suppliers/:id', authorize('admin', 'manager'), validate(updateSupplierSchema), async (req, res, next) => {
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
       LEFT JOIN suppliers s ON po.supplier_id = s.id AND s.store_id = po.store_id
       LEFT JOIN users u ON po.user_id = u.id AND u.store_id = po.store_id
       WHERE po.store_id = $1 ORDER BY po.created_at DESC`,
      [req.user.store_id]
    );
    res.json({ purchaseOrders: result.rows });
  } catch (err) { next(err); }
});

router.post('/purchase-orders', authorize('admin', 'manager'), validate(createPurchaseOrderSchema), async (req, res, next) => {
  let client;
  try {
    const { supplier_id, items, notes } = req.body;
    client = await getClient();
    await client.query('BEGIN');

    const supplier = await client.query(
      'SELECT id FROM suppliers WHERE id = $1 AND store_id = $2',
      [supplier_id, req.user.store_id]
    );
    if (!supplier.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Supplier does not belong to this store' });
    }

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const products = await client.query(
      'SELECT id FROM products WHERE store_id = $1 AND id = ANY($2::int[])',
      [req.user.store_id, productIds]
    );
    if (products.rows.length !== productIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Every product must belong to this store' });
    }

    const total = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);

    const poResult = await client.query(
      `INSERT INTO purchase_orders (store_id, supplier_id, user_id, total, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.store_id, supplier_id, req.user.id, total, notes || null]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_order_items
         (purchase_order_id, product_id, store_id, quantity, unit_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [poResult.rows[0].id, item.product_id, req.user.store_id, item.quantity, item.unit_cost]
      );
    }
    await client.query('COMMIT');

    res.status(201).json({ purchaseOrder: poResult.rows[0] });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    next(err);
  } finally {
    client?.release();
  }
});

export default router;
