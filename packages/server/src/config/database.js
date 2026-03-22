import pg from 'pg';
import config from './index.js';
import logger from './logger.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.db.connectionString,
  ssl: config.db.connectionString?.includes('neon.tech') || config.db.connectionString?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', err);
});

// Helper to run a single query
export const query = (text, params) => pool.query(text, params);

// Helper to get a client for transactions
export const getClient = () => pool.connect();

export default pool;
