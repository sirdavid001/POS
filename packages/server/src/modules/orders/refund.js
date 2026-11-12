// Full refund of a completed sale, run inside the caller's transaction.
//
// No schema change is needed: the order moves to status 'refunded' (reports and statements
// already count only 'completed' orders), a negative payment row records who refunded it and
// why, and restocked items go back through inventory_logs like any other stock movement.

export class RefundError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function refundOrder(client, { orderId, storeId, userId, reason, restock = true }) {
  const orderResult = await client.query(
    'SELECT * FROM orders WHERE id = $1 AND store_id = $2 FOR UPDATE',
    [orderId, storeId]
  );
  const order = orderResult.rows[0];
  if (!order) throw new RefundError(404, 'Order not found');
  if (order.status === 'refunded') throw new RefundError(409, 'This sale has already been refunded');
  if (order.status !== 'completed') throw new RefundError(409, 'Only completed sales can be refunded');

  const itemsResult = await client.query(
    'SELECT product_id, product_name, quantity FROM order_items WHERE order_id = $1 AND store_id = $2',
    [orderId, storeId]
  );

  let restockedItems = 0;
  if (restock) {
    for (const item of itemsResult.rows) {
      if (!item.product_id) continue;
      const updated = await client.query(
        `UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW()
         WHERE id = $2 AND store_id = $3
         RETURNING id`,
        [item.quantity, item.product_id, storeId]
      );
      if (!updated.rows[0]) continue;
      await client.query(
        `INSERT INTO inventory_logs (product_id, store_id, user_id, type, quantity, reason)
         VALUES ($1, $2, $3, 'in', $4, $5)`,
        [item.product_id, storeId, userId, item.quantity, `Refund ${order.order_number}`]
      );
      restockedItems += 1;
    }
  }

  const updatedOrder = await client.query(
    `UPDATE orders SET status = 'refunded', updated_at = NOW()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [orderId, storeId]
  );

  const refundedAt = new Date().toISOString();
  await client.query(
    `INSERT INTO payments (order_id, store_id, amount, method, provider, reference, status, metadata)
     VALUES ($1, $2, $3, $4, 'refund', NULL, 'refunded', $5)`,
    [
      orderId,
      storeId,
      -Number(order.total),
      order.payment_method || 'cash',
      JSON.stringify({ reason, refunded_by: userId, refunded_at: refundedAt, restocked: Boolean(restock) }),
    ]
  );

  await client.query(
    `INSERT INTO audit_logs (store_id, user_id, entity_type, entity_id, action, new_values)
     VALUES ($1, $2, 'order', $3, 'refund', $4)`,
    [storeId, userId, orderId, JSON.stringify({ order_number: order.order_number, total: order.total, reason, restock: Boolean(restock) })]
  );

  return {
    order: updatedOrder.rows[0],
    refund: { amount: Number(order.total), reason, restocked: Boolean(restock), restocked_items: restockedItems, refunded_at: refundedAt },
  };
}
