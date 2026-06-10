import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
INSERT INTO roles (name, permissions) VALUES
  ('admin', '["all"]'),
  ('manager', '["products", "orders", "inventory", "customers", "reports"]'),
  ('cashier', '["orders", "customers"]')
ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions;

CREATE TABLE IF NOT EXISTS subscription_plans (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price_ngn INTEGER NOT NULL CHECK (price_ngn >= 0),
  duration_months INTEGER NOT NULL CHECK (duration_months > 0),
  billing_interval VARCHAR(30),
  recurring BOOLEAN NOT NULL DEFAULT true,
  is_promotional BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans
  (code, name, price_ngn, duration_months, billing_interval, recurring, is_promotional)
VALUES
  ('monthly', 'Monthly', 5000, 1, 'monthly', true, false),
  ('quarterly', 'Quarterly', 13500, 3, 'quarterly', true, false),
  ('yearly', 'Yearly', 50000, 12, 'annually', true, false),
  ('launch_6m', 'Launch Offer', 20000, 6, NULL, false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  price_ngn = EXCLUDED.price_ngn,
  duration_months = EXCLUDED.duration_months,
  billing_interval = EXCLUDED.billing_interval,
  recurring = EXCLUDED.recurring,
  is_promotional = EXCLUDED.is_promotional,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS store_subscriptions (
  id SERIAL PRIMARY KEY,
  store_id INTEGER UNIQUE NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan_code VARCHAR(50) REFERENCES subscription_plans(code),
  status VARCHAR(30) NOT NULL DEFAULT 'trialing',
  provider VARCHAR(30),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  provider_customer_id VARCHAR(255),
  provider_subscription_id VARCHAR(255),
  provider_email_token VARCHAR(255),
  launch_offer_redeemed BOOLEAN NOT NULL DEFAULT false,
  last_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'grandfathered'))
);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id BIGSERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,
  provider_reference VARCHAR(255) NOT NULL,
  provider_transaction_id VARCHAR(255),
  plan_code VARCHAR(50) REFERENCES subscription_plans(code),
  amount_ngn INTEGER NOT NULL CHECK (amount_ngn >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  status VARCHAR(30) NOT NULL DEFAULT 'initialized',
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_reference)
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  event_key VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'received',
  error TEXT,
  processed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_key)
);

CREATE TABLE IF NOT EXISTS subscription_notifications (
  id BIGSERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  notification_type VARCHAR(80) NOT NULL,
  notification_key VARCHAR(255) NOT NULL,
  provider_message_id VARCHAR(255),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, notification_type, notification_key)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

DO $$
DECLARE
  target_column TEXT;
BEGIN
  FOREACH target_column IN ARRAY ARRAY[
    'trial_started_at', 'trial_ends_at', 'current_period_start',
    'current_period_end', 'last_verified_at', 'created_at', 'updated_at'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_name = 'store_subscriptions'
        AND c.column_name = target_column
        AND c.data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE store_subscriptions ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
        target_column,
        target_column
      );
    END IF;
  END LOOP;

  FOREACH target_column IN ARRAY ARRAY['paid_at', 'created_at', 'updated_at']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_name = 'billing_transactions'
        AND c.column_name = target_column
        AND c.data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE billing_transactions ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
        target_column,
        target_column
      );
    END IF;
  END LOOP;

  FOREACH target_column IN ARRAY ARRAY['processed_at', 'received_at']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_name = 'billing_webhook_events'
        AND c.column_name = target_column
        AND c.data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE billing_webhook_events ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
        target_column,
        target_column
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_name = 'subscription_notifications'
      AND c.column_name = 'sent_at'
      AND c.data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE subscription_notifications
      ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at AT TIME ZONE 'UTC';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_store_subscriptions_status
  ON store_subscriptions(status, current_period_end, trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_store
  ON billing_transactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_provider_id
  ON billing_transactions(provider, provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_billing_webhooks_status
  ON billing_webhook_events(status, received_at);

-- Existing stores retain access until they are migrated manually.
INSERT INTO store_subscriptions (store_id, status, last_verified_at, metadata)
SELECT id, 'grandfathered', NOW(), '{"migration":"002_subscriptions"}'::jsonb
FROM stores
ON CONFLICT (store_id) DO NOTHING;
`;

export async function up() {
  logger.info('Running migration: 002_subscriptions');
  await query(migration);
  logger.info('Migration 002_subscriptions completed');
}
