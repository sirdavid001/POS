import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_granted_at
  ON platform_admins(granted_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created_at
  ON platform_audit_logs(created_at DESC);
`;

export async function up() {
  logger.info('Running migration: 010_platform_admins');
  await query(migration);
  logger.info('Migration 010_platform_admins completed');
}
