import { query } from '../../config/database.js';

const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function toDate(value) {
  return value ? new Date(value) : null;
}

function earliestDate(...values) {
  const dates = values.filter(Boolean).map(toDate);
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

export function serializeSubscription(row, now = new Date()) {
  if (!row) {
    return {
      status: 'expired',
      can_write: false,
      offline_valid_until: now.toISOString(),
    };
  }

  const trialEndsAt = toDate(row.trial_ends_at);
  const periodEndsAt = toDate(row.current_period_end);
  const knownEntitlementEnd = row.status === 'trialing' ? trialEndsAt : periodEndsAt;
  let effectiveStatus = row.status;

  if (
    !['grandfathered', 'pending_activation'].includes(effectiveStatus) &&
    (!knownEntitlementEnd || knownEntitlementEnd.getTime() <= now.getTime())
  ) {
    effectiveStatus = 'expired';
  }

  const canWrite =
    effectiveStatus === 'grandfathered' ||
    (
      ['trialing', 'active', 'past_due', 'cancelled'].includes(effectiveStatus) &&
      knownEntitlementEnd?.getTime() > now.getTime()
    );

  const offlineLimit = new Date(now.getTime() + OFFLINE_WINDOW_MS);
  const offlineValidUntil =
    effectiveStatus === 'grandfathered'
      ? offlineLimit
      : earliestDate(knownEntitlementEnd, offlineLimit) || now;

  const remainingMs = knownEntitlementEnd
    ? Math.max(0, knownEntitlementEnd.getTime() - now.getTime())
    : null;

  return {
    id: row.id,
    store_id: row.store_id,
    status: effectiveStatus,
    stored_status: row.status,
    plan_code: row.plan_code,
    plan_name: row.plan_name,
    price_ngn: row.price_ngn == null ? null : Number(row.price_ngn),
    provider: row.provider,
    recurring: row.recurring,
    trial_started_at: row.trial_started_at,
    trial_ends_at: row.trial_ends_at,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
    launch_offer_redeemed: row.launch_offer_redeemed,
    activation_fee_paid: Boolean(row.activation_fee_paid),
    activation_required:
      row.status !== 'grandfathered' && !Boolean(row.activation_fee_paid),
    last_verified_at: row.last_verified_at,
    can_write: canWrite,
    entitlement_ends_at: knownEntitlementEnd?.toISOString() || null,
    offline_valid_until: offlineValidUntil.toISOString(),
    days_remaining: remainingMs == null ? null : Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
    server_time: now.toISOString(),
  };
}

export async function getStoreSubscription(storeId, queryFn = query) {
  const result = await queryFn(
    `SELECT ss.*, sp.name AS plan_name, sp.price_ngn, sp.recurring
     FROM store_subscriptions ss
     LEFT JOIN subscription_plans sp ON sp.code = ss.plan_code
     WHERE ss.store_id = $1`,
    [storeId]
  );

  return serializeSubscription(result.rows[0]);
}

export async function createPendingActivation(client, storeId) {
  const result = await client.query(
    `INSERT INTO store_subscriptions (
       store_id, status, activation_fee_paid, last_verified_at
     )
     VALUES ($1, 'pending_activation', false, NOW())
     RETURNING *`,
    [storeId]
  );
  return serializeSubscription(result.rows[0]);
}

export async function getPlan(planCode, queryFn = query) {
  const result = await queryFn(
    'SELECT * FROM subscription_plans WHERE code = $1 AND is_active = true',
    [planCode]
  );
  return result.rows[0] || null;
}

export function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + Number(months));
  const finalDay = new Date(Date.UTC(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    0
  )).getUTCDate();
  next.setUTCDate(Math.min(day, finalDay));
  return next;
}
