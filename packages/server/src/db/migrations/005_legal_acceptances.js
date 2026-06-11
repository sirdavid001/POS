import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  document_type VARCHAR(30) NOT NULL
    CHECK (document_type IN ('terms', 'privacy', 'refund')),
  document_version VARCHAR(30) NOT NULL,
  context VARCHAR(30) NOT NULL
    CHECK (context IN ('registration', 'checkout')),
  ip_address VARCHAR(100),
  user_agent TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, document_type, document_version, context)
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_store
  ON legal_acceptances(store_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON legal_acceptances(user_id, accepted_at DESC);
`;

export async function up() {
  logger.info('Running migration: 005_legal_acceptances');
  await query(migration);
  logger.info('Migration 005_legal_acceptances completed');
}
