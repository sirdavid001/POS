import { finalizeInsights, insightsRange } from '../../../../shared/src/insights.js';

const COMPLETED_IN_RANGE = `o.store_id = $1 AND o.status = 'completed'
  AND o.created_at >= $2::date AND o.created_at < $3::date + 1`;

export { insightsRange };

/** Owner insights for an inclusive date range, aggregated in SQL. */
export async function getInsights(query, storeId, range, { productLimit = 25 } = {}) {
  const current = [storeId, range.start, range.end];
  const [summary, previous, refunds, items, paymentMethods, cashiers, products] = await Promise.all([
    query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue,
              COALESCE(SUM(o.discount_amount), 0) AS discounts, COALESCE(SUM(o.tax_amount), 0) AS tax
       FROM orders o WHERE ${COMPLETED_IN_RANGE}`,
      current
    ),
    query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o WHERE ${COMPLETED_IN_RANGE}`,
      [storeId, range.previous_start, range.previous_end]
    ),
    query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(-p.amount), 0) AS total
       FROM payments p
       WHERE p.store_id = $1 AND p.status = 'refunded'
         AND p.created_at >= $2::date AND p.created_at < $3::date + 1`,
      current
    ),
    query(
      `SELECT COALESCE(SUM(oi.total), 0) AS revenue, COALESCE(SUM(oi.quantity), 0) AS quantity,
              COALESCE(SUM(oi.quantity * pr.cost_price) FILTER (WHERE pr.cost_price > 0), 0) AS cost,
              COALESCE(SUM(oi.total) FILTER (WHERE pr.cost_price > 0), 0) AS costed_revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
       LEFT JOIN products pr ON pr.id = oi.product_id AND pr.store_id = oi.store_id
       WHERE ${COMPLETED_IN_RANGE}`,
      current
    ),
    query(
      `SELECT COALESCE(o.payment_method, 'cash') AS method, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o WHERE ${COMPLETED_IN_RANGE}
       GROUP BY COALESCE(o.payment_method, 'cash')
       ORDER BY revenue DESC`,
      current
    ),
    query(
      `SELECT COALESCE(u.name, 'Unknown') AS cashier, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id AND u.store_id = o.store_id
       WHERE ${COMPLETED_IN_RANGE}
       GROUP BY COALESCE(u.name, 'Unknown')
       ORDER BY revenue DESC`,
      current
    ),
    query(
      `SELECT oi.product_name, SUM(oi.quantity) AS quantity, SUM(oi.total) AS revenue,
              SUM(oi.quantity * pr.cost_price) FILTER (WHERE pr.cost_price > 0) AS cost,
              COALESCE(SUM(oi.total) FILTER (WHERE pr.cost_price > 0), 0) AS costed_revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
       LEFT JOIN products pr ON pr.id = oi.product_id AND pr.store_id = oi.store_id
       WHERE ${COMPLETED_IN_RANGE}
       GROUP BY oi.product_name
       ORDER BY revenue DESC
       LIMIT $4`,
      [...current, productLimit]
    ),
  ]);

  return finalizeInsights({
    range,
    summary: summary.rows[0],
    previous: previous.rows[0],
    refunds: refunds.rows[0],
    items: items.rows[0],
    paymentMethods: paymentMethods.rows,
    cashiers: cashiers.rows,
    products: products.rows,
  });
}
