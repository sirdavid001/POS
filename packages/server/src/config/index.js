import dotenv from 'dotenv';
// Load .env for local development; Vercel injects env vars directly
if (process.env.VERCEL !== '1') {
  dotenv.config({ path: '../../.env' });
}

function buildDatabaseConfig() {
  const connectionStringEnvVars = [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['POSTGRES_URL', process.env.POSTGRES_URL],
    ['DATABASE_URL_UNPOOLED', process.env.DATABASE_URL_UNPOOLED],
    ['POSTGRES_URL_NON_POOLING', process.env.POSTGRES_URL_NON_POOLING],
  ];

  for (const [source, value] of connectionStringEnvVars) {
    if (value) {
      return { connectionString: value, source };
    }
  }

  const host = process.env.POSTGRES_HOST || process.env.PGHOST;
  const port = process.env.POSTGRES_PORT || process.env.PGPORT || '5432';
  const user = process.env.POSTGRES_USER || process.env.PGUSER;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE;

  if (host && user && password && database) {
    const url = new URL(`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`);
    const needsSsl =
      host.includes('neon.tech') ||
      host.includes('vercel-storage.com') ||
      process.env.NODE_ENV === 'production';

    if (needsSsl) {
      url.searchParams.set('sslmode', 'require');
    }

    return {
      connectionString: url.toString(),
      source: host === (process.env.POSTGRES_HOST || '') ? 'POSTGRES_HOST' : 'PGHOST',
    };
  }

  return {
    connectionString: 'postgresql://pos_user:pos_password@localhost:5432/pos_db',
    source: 'local-default',
  };
}

const db = buildDatabaseConfig();

const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  db,

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    expiry: process.env.JWT_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  },
};

export default config;
