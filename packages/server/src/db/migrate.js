import { up as migration001 } from './migrations/001_initial_schema.js';
import logger from '../config/logger.js';

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');
    await migration001();
    logger.info('All migrations completed successfully');
    process.exit(0);
  } catch (err) {
    logger.error('Migration failed', err);
    process.exit(1);
  }
}

runMigrations();
