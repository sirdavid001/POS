import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { requireActiveSubscription } from '../../middleware/subscription.js';

const router = Router();
router.use(authenticate);
router.use(requireActiveSubscription());

router.get('/bootstrap', async (req, res, next) => {
  try {
    const storeId = req.user.store_id;
    const canManage = ['admin', 'manager'].includes(req.user.role);
    const [store, products, categories, customers, suppliers, orders, logs, users] = await Promise.all([
      query('SELECT * FROM stores WHERE id = $1', [storeId]),
      query(
        `SELECT p.*, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         WHERE p.store_id = $1
         ORDER BY p.name`,
        [storeId]
      ),
      query('SELECT * FROM categories WHERE store_id = $1 ORDER BY name', [storeId]),
      query('SELECT * FROM customers WHERE store_id = $1 ORDER BY name', [storeId]),
      query('SELECT * FROM suppliers WHERE store_id = $1 ORDER BY name', [storeId]),
      canManage
        ? query(
          `SELECT o.*, u.name AS cashier_name, c.name AS customer_name,
                  COALESCE(
                    JSONB_AGG(
                      JSONB_BUILD_OBJECT(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'product_name', oi.product_name,
                        'quantity', oi.quantity,
                        'unit_price', oi.unit_price,
                        'discount', oi.discount,
                        'total', oi.total
                      ) ORDER BY oi.id
                    ) FILTER (WHERE oi.id IS NOT NULL),
                    '[]'::jsonb
                  ) AS items
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id AND u.store_id = o.store_id
           LEFT JOIN customers c ON c.id = o.customer_id AND c.store_id = o.store_id
           LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.store_id = o.store_id
           WHERE o.store_id = $1
           GROUP BY o.id, u.name, c.name
           ORDER BY o.created_at DESC
           LIMIT 500`,
          [storeId]
        )
        : Promise.resolve({ rows: [] }),
      canManage
        ? query(
          `SELECT il.*, p.name AS product_name, u.name AS user_name, s.name AS supplier_name
           FROM inventory_logs il
           LEFT JOIN products p ON p.id = il.product_id AND p.store_id = il.store_id
           LEFT JOIN users u ON u.id = il.user_id AND u.store_id = il.store_id
           LEFT JOIN suppliers s ON s.id = il.supplier_id AND s.store_id = il.store_id
           WHERE il.store_id = $1
           ORDER BY il.created_at DESC
           LIMIT 500`,
          [storeId]
        )
        : Promise.resolve({ rows: [] }),
      canManage
        ? query(
          `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.created_at,
                  r.name AS role, creator.name AS created_by
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN users creator ON creator.id = u.created_by_user_id AND creator.store_id = u.store_id
           WHERE u.store_id = $1
           ORDER BY u.created_at`,
          [storeId]
        )
        : Promise.resolve({ rows: [] }),
    ]);

    res.json({
      snapshot: {
        store: store.rows[0] || null,
        products: products.rows,
        categories: categories.rows,
        customers: customers.rows,
        suppliers: suppliers.rows,
        orders: orders.rows,
        logs: logs.rows,
        users: users.rows,
      },
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
