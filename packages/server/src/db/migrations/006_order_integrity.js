import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_order_id VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_client_order
  ON orders(store_id, client_order_id)
  WHERE client_order_id IS NOT NULL;
`;

export async function up() {
  logger.info('Running migration: 006_order_integrity');
  await query(migration);
  logger.info('Migration 006_order_integrity completed');
}
