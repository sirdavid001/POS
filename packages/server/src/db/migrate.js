import { up as migration001 } from './migrations/001_initial_schema.js';
import { up as migration002 } from './migrations/002_subscriptions.js';
import { up as migration003 } from './migrations/003_password_resets.js';
import logger from '../config/logger.js';

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');
    await migration001();
    await migration002();
    await migration003();
    logger.info('All migrations completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error('Migration failed', err);
    process.exit(1);
  }
}

runMigrations();
