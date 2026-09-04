import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope VARCHAR(80) NOT NULL,
  client_key CHAR(64) NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  reset_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, client_key)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_reset
  ON api_rate_limits(reset_at);
`;

export async function up() {
  logger.info('Running migration: 008_rate_limits');
  await query(migration);
  logger.info('Migration 008_rate_limits completed');
}
