import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.use(authorize('admin', 'manager'));

// Sales summary (daily/weekly/monthly)
router.get('/sales', async (req, res, next) => {
  try {
    const { period = 'daily', start_date, end_date } = req.query;
    const storeId = req.user.store_id;

    let groupBy, dateFormat;
    switch (period) {
      case 'weekly': groupBy = "DATE_TRUNC('week', created_at)"; dateFormat = 'YYYY-IW'; break;
      case 'monthly': groupBy = "DATE_TRUNC('month', created_at)"; dateFormat = 'YYYY-MM'; break;
      default: groupBy = "DATE_TRUNC('day', created_at)"; dateFormat = 'YYYY-MM-DD';
    }

    let sql = `
      SELECT
        TO_CHAR(${groupBy}, '${dateFormat}') as period,
        COUNT(*) as total_orders,
        SUM(total) as revenue,
        SUM(discount_amount) as total_discounts,
        SUM(tax_amount) as total_tax,
        AVG(total) as avg_order_value
      FROM orders
      WHERE store_id = $1 AND status = 'completed'
    `;
    const params = [storeId];
    let idx = 2;

    if (start_date) { sql += ` AND created_at >= $${idx}`; params.push(start_date); idx++; }
    if (end_date) { sql += ` AND created_at <= $${idx}`; params.push(end_date); idx++; }

    sql += ` GROUP BY ${groupBy} ORDER BY ${groupBy} DESC LIMIT 30`;

    const result = await query(sql, params);
    res.json({ sales: result.rows });
  } catch (err) { next(err); }
});

// Revenue overview
router.get('/revenue', async (req, res, next) => {
  try {
    const storeId = req.user.store_id;

    const today = await query(
      `SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders
       FROM orders WHERE store_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE`,
      [storeId]
    );

    const thisWeek = await query(
      `SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders
       FROM orders WHERE store_id = $1 AND status = 'completed' AND created_at >= DATE_TRUNC('week', CURRENT_DATE)`,
      [storeId]
    );

    const thisMonth = await query(
      `SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders
       FROM orders WHERE store_id = $1 AND status = 'completed' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [storeId]
    );

    const allTime = await query(
      `SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders FROM orders WHERE store_id = $1 AND status = 'completed'`,
      [storeId]
    );

    res.json({
      today: today.rows[0],
      thisWeek: thisWeek.rows[0],
      thisMonth: thisMonth.rows[0],
      allTime: allTime.rows[0],
    });
  } catch (err) { next(err); }
});

// Top selling products
router.get('/top-products', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const result = await query(
      `SELECT oi.product_name, SUM(oi.quantity) as total_quantity, SUM(oi.total) as total_revenue
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.store_id = $1 AND o.status = 'completed'
       GROUP BY oi.product_name
       ORDER BY total_quantity DESC LIMIT $2`,
      [req.user.store_id, limit]
    );
    res.json({ products: result.rows });
  } catch (err) { next(err); }
});

// Recent orders for dashboard
router.get('/recent-orders', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT o.id, o.order_number, o.total, o.payment_method, o.created_at, u.name as cashier
       FROM orders o LEFT JOIN users u ON o.user_id = u.id
       WHERE o.store_id = $1 ORDER BY o.created_at DESC LIMIT 10`,
      [req.user.store_id]
    );
    res.json({ orders: result.rows });
  } catch (err) { next(err); }
});

export default router;
