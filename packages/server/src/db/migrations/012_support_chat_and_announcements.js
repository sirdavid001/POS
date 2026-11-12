import { query } from '../../config/database.js';
import logger from '../../config/logger.js';

// Live support chat between a store and QuickPOS, and platform announcements
// shown inside every store's POS app.
const migration = `
CREATE TABLE IF NOT EXISTS support_conversations (
  id BIGSERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  started_by VARCHAR(10) NOT NULL DEFAULT 'store' CHECK (started_by IN ('store', 'admin')),
  started_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview VARCHAR(160),
  last_sender VARCHAR(10) CHECK (last_sender IN ('store', 'admin', 'system')),
  store_last_read_at TIMESTAMPTZ,
  admin_last_read_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_conversations_one_open
  ON support_conversations(store_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_support_conversations_recent
  ON support_conversations(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('store', 'admin', 'system')),
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_conversation
  ON support_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS platform_announcements (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(600) NOT NULL,
  level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'success')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ended_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_window
  ON platform_announcements(starts_at DESC, ends_at);
`;

export async function up() {
  logger.info('Running migration: 012_support_chat_and_announcements');
  await query(migration);
  logger.info('Migration 012_support_chat_and_announcements completed');
}
