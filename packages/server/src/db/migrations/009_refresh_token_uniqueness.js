import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
DELETE FROM refresh_tokens WHERE expires_at <= NOW();

DELETE FROM refresh_tokens older
USING refresh_tokens newer
WHERE older.token = newer.token AND older.id < newer.id;

DROP INDEX IF EXISTS idx_refresh_tokens_token;
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_unique
  ON refresh_tokens(token);
`;

export async function up() {
  logger.info('Running migration: 009_refresh_token_uniqueness');
  await query(migration);
  logger.info('Migration 009_refresh_token_uniqueness completed');
}
