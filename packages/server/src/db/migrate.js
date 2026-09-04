import { up as migration001 } from './migrations/001_initial_schema.js';
import { up as migration002 } from './migrations/002_subscriptions.js';
import { up as migration003 } from './migrations/003_password_resets.js';
import { up as migration004 } from './migrations/004_initial_activation.js';
import { up as migration005 } from './migrations/005_legal_acceptances.js';
import { up as migration006 } from './migrations/006_order_integrity.js';
import { up as migration007 } from './migrations/007_tenant_integrity.js';
import { up as migration008 } from './migrations/008_rate_limits.js';
import { up as migration009 } from './migrations/009_refresh_token_uniqueness.js';
import { getClient, query } from '../config/database.js';
import logger from '../config/logger.js';

const migrations = [
  ['001_initial_schema', migration001],
  ['002_subscriptions', migration002],
  ['003_password_resets', migration003],
  ['004_initial_activation', migration004],
  ['005_legal_acceptances', migration005],
  ['006_order_integrity', migration006],
  ['007_tenant_integrity', migration007],
  ['008_rate_limits', migration008],
  ['009_refresh_token_uniqueness', migration009],
];

async function runMigrations() {
  let lockClient;
  try {
    logger.info('Starting database migrations...');
    lockClient = await getClient();
    await lockClient.query("SELECT pg_advisory_lock(hashtext('quickpos_schema_migrations'))");
    await query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const [name, migrate] of migrations) {
      const applied = await query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (applied.rows[0]) continue;
      await migrate();
      await query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
    logger.info('All migrations completed successfully');
  } catch (err) {
    logger.error('Migration failed', err);
    process.exitCode = 1;
  } finally {
    if (lockClient) {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext('quickpos_schema_migrations'))");
      lockClient.release();
    }
  }
}

await runMigrations();
process.exit();
