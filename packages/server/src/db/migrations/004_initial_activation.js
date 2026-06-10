import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

const migration = `
INSERT INTO subscription_plans
  (code, name, price_ngn, duration_months, billing_interval, recurring, is_promotional, is_active)
VALUES
  ('activation_5m', 'Initial Activation', 20000, 5, NULL, false, false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  price_ngn = EXCLUDED.price_ngn,
  duration_months = EXCLUDED.duration_months,
  billing_interval = EXCLUDED.billing_interval,
  recurring = EXCLUDED.recurring,
  is_promotional = EXCLUDED.is_promotional,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

UPDATE subscription_plans
SET is_active = false, updated_at = NOW()
WHERE code = 'launch_6m';

ALTER TABLE store_subscriptions
  ADD COLUMN IF NOT EXISTS activation_fee_paid BOOLEAN NOT NULL DEFAULT false;

UPDATE store_subscriptions
SET activation_fee_paid = true
WHERE status IN ('active', 'past_due', 'cancelled', 'grandfathered')
   OR launch_offer_redeemed = true;

ALTER TABLE store_subscriptions
  DROP CONSTRAINT IF EXISTS store_subscriptions_status_check;

ALTER TABLE store_subscriptions
  ADD CONSTRAINT store_subscriptions_status_check
  CHECK (status IN (
    'pending_activation', 'trialing', 'active', 'past_due',
    'cancelled', 'expired', 'grandfathered'
  ));
`;

export async function up() {
  logger.info('Running migration: 004_initial_activation');
  await query(migration);
  logger.info('Migration 004_initial_activation completed');
}
