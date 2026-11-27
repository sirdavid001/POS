import { query } from '../../config/database.js';

export const staffBadgesMigration = `
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS badge_checkout_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_photo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_badge_hash CHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_badge_issued_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_pin_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_staff_badge ON users(store_id, staff_badge_hash)
  WHERE staff_badge_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION clear_staff_badge_on_access_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role_id IS DISTINCT FROM OLD.role_id OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.staff_badge_hash := NULL;
    NEW.staff_badge_issued_at := NULL;
    NEW.register_pin_hash := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS staff_badge_access_change ON users;
CREATE TRIGGER staff_badge_access_change BEFORE UPDATE OF role_id, is_active ON users
  FOR EACH ROW EXECUTE FUNCTION clear_staff_badge_on_access_change();

CREATE OR REPLACE FUNCTION log_store_staff_access() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE role_name TEXT;
BEGIN
  IF NEW.store_id IS NOT NULL AND NEW.last_login IS DISTINCT FROM OLD.last_login AND NEW.last_login IS NOT NULL THEN
    SELECT name INTO role_name FROM roles WHERE id = NEW.role_id;
    INSERT INTO audit_logs (store_id, user_id, entity_type, entity_id, action, new_values)
    VALUES (NEW.store_id, NEW.id, 'auth', NEW.id, 'account_login',
      jsonb_build_object('actor_name', NEW.name, 'actor_role', role_name));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS log_store_staff_login ON users;
CREATE TRIGGER log_store_staff_login AFTER UPDATE OF last_login ON users
  FOR EACH ROW EXECUTE FUNCTION log_store_staff_access();

CREATE TABLE IF NOT EXISTS register_sessions (
  id UUID PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  host_id INTEGER NOT NULL,
  terminal_id UUID NOT NULL,
  cashier_id INTEGER NOT NULL,
  badge_hash CHAR(64) NOT NULL,
  cart JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  FOREIGN KEY (host_id, store_id) REFERENCES users(id, store_id) ON DELETE CASCADE,
  FOREIGN KEY (cashier_id, store_id) REFERENCES users(id, store_id) ON DELETE CASCADE,
  UNIQUE (id, store_id)
);
CREATE INDEX IF NOT EXISTS idx_register_sessions_host ON register_sessions(host_id, store_id);
CREATE INDEX IF NOT EXISTS idx_register_sessions_cashier ON register_sessions(cashier_id, store_id);
CREATE INDEX IF NOT EXISTS idx_register_sessions_expiry ON register_sessions(store_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_register_sessions_open_terminal
  ON register_sessions(store_id, host_id, terminal_id) WHERE closed_at IS NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS register_session_id UUID;
CREATE INDEX IF NOT EXISTS idx_audit_logs_store_cursor ON audit_logs(store_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_positive_success
  ON billing_transactions(store_id) WHERE status = 'success' AND amount_ngn > 0;
COMMIT;
`;

export const up = () => query(staffBadgesMigration);
