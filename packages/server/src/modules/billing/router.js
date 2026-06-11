import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { authenticate, authorize } from '../../middleware/auth.js';
import { getClient, query } from '../../config/database.js';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { addMonths, getPlan, getStoreSubscription } from './subscription.js';
import { sendBillingEmail } from './email.js';
import {
  getProviderAvailability,
  getPlanProviderAvailability,
  providerError,
  verifyFlutterwaveWebhook,
  verifyPaystackWebhook,
} from './providers.js';
import {
  checkoutAmountForPlan,
  currencyDisclosure,
  preferredCurrencyForRequest,
  providerPlanIdForCurrency,
} from './currency.js';
import { checkoutSchema } from './schema.js';
import { LEGAL_DOCUMENT_VERSIONS, recordLegalAcceptances } from '../legal.js';

const router = Router();

function verifyPaystackSignature(req) {
  return verifyPaystackWebhook(
    req.rawBody || Buffer.from(JSON.stringify(req.body)),
    req.get('x-paystack-signature'),
    config.paystack.secretKey
  );
}

function verifyFlutterwaveSignature(req) {
  return verifyFlutterwaveWebhook(
    req.rawBody || Buffer.from(JSON.stringify(req.body)),
    req.get('flutterwave-signature') || req.get('verif-hash'),
    config.flutterwave.webhookSecret
  );
}

function eventKey(provider, req) {
  const data = req.body?.data || {};
  const nativeId =
    req.get('x-paystack-event-id') ||
    req.body?.id ||
    data.id ||
    data.reference ||
    data.tx_ref ||
    data.subscription_code;
  if (nativeId) return `${req.body?.event || req.body?.type || 'event'}:${nativeId}`;
  return crypto.createHash('sha256').update(req.rawBody || JSON.stringify(req.body)).digest('hex');
}

function providerPlanId(provider, planCode, currency = 'NGN') {
  return providerPlanIdForCurrency(config, provider, planCode, currency);
}

function formatMoney(amount, currency = 'NGN') {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(Number(amount || 0));
}

async function getBillingIdentity(storeId) {
  const result = await query(
    `SELECT s.id, s.name, COALESCE(s.email, owner.email) AS email
     FROM stores s
     LEFT JOIN LATERAL (
       SELECT u.email
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.store_id = s.id AND r.name = 'admin' AND u.is_active = true
       ORDER BY u.created_at
       LIMIT 1
     ) owner ON true
     WHERE s.id = $1`,
    [storeId]
  );
  return result.rows[0];
}

async function initialActivationEligible(storeId, subscription) {
  if (subscription.activation_fee_paid) return false;
  const result = await query(
    `SELECT EXISTS(
       SELECT 1 FROM billing_transactions
       WHERE store_id = $1 AND status = 'success'
     ) AS has_paid`,
    [storeId]
  );
  return !result.rows[0].has_paid;
}

async function verifyPaystackTransaction(reference) {
  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${config.paystack.secretKey}` } }
  );
  const data = response.data?.data;
  if (!response.data?.status || data?.status !== 'success') {
    throw new Error('Paystack transaction is not successful');
  }
  return {
    reference: data.reference,
    transactionId: String(data.id),
    amountNgn: Number(data.amount) / 100,
    currency: data.currency,
    paidAt: data.paid_at || data.paidAt,
    metadata: typeof data.metadata === 'string' ? JSON.parse(data.metadata || '{}') : data.metadata || {},
    providerCustomerId: data.customer?.customer_code,
    providerSubscriptionId: data.subscription?.subscription_code,
    providerEmailToken: data.subscription?.email_token,
    raw: data,
  };
}

async function verifyFlutterwaveTransaction(transactionId) {
  const response = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,
    { headers: { Authorization: `Bearer ${config.flutterwave.secretKey}` } }
  );
  const data = response.data?.data;
  if (
    response.data?.status !== 'success' ||
    !['successful', 'succeeded'].includes(data?.status)
  ) {
    throw new Error('Flutterwave transaction is not successful');
  }
  return {
    reference: data.tx_ref,
    transactionId: String(data.id),
    amountNgn: Number(data.amount),
    currency: data.currency,
    paidAt: data.created_at,
    metadata: data.meta || {},
    providerCustomerId: data.customer?.id ? String(data.customer.id) : null,
    providerSubscriptionId: data.subscription_id ? String(data.subscription_id) : null,
    raw: data,
  };
}

async function activateVerifiedPayment(provider, verified) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    let transactionResult = await client.query(
      `SELECT * FROM billing_transactions
       WHERE provider = $1 AND provider_reference = $2
       FOR UPDATE`,
      [provider, verified.reference]
    );
    let transaction = transactionResult.rows[0];

    if (!transaction) {
      const subscriptionResult = await client.query(
        `SELECT *
         FROM store_subscriptions
         WHERE provider = $1
           AND (
             ($2::text IS NOT NULL AND provider_subscription_id = $2)
             OR ($3::text IS NOT NULL AND provider_customer_id = $3)
             OR ($4::int IS NOT NULL AND store_id = $4)
           )
         ORDER BY updated_at DESC
         LIMIT 1
         FOR UPDATE`,
        [
          provider,
          verified.providerSubscriptionId || null,
          verified.providerCustomerId || null,
          Number(verified.metadata?.store_id) || null,
        ]
      );
      const subscription = subscriptionResult.rows[0];
      if (!subscription) throw new Error('Verified renewal could not be matched to a QuickPOS store');
      const planCode = verified.metadata?.plan_code || subscription.plan_code;

      transactionResult = await client.query(
        `INSERT INTO billing_transactions
         (store_id, provider, provider_reference, provider_transaction_id, plan_code,
          amount_ngn, currency, status, paid_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'initialized', $8, $9)
         ON CONFLICT (provider, provider_reference) DO UPDATE SET
           provider_transaction_id = COALESCE(EXCLUDED.provider_transaction_id, billing_transactions.provider_transaction_id)
         RETURNING *`,
        [
          subscription.store_id,
          provider,
          verified.reference,
          verified.transactionId,
          planCode,
          Math.round(verified.amountNgn),
          verified.currency,
          verified.paidAt || new Date(),
          JSON.stringify({ automatic_renewal: true }),
        ]
      );
      transaction = transactionResult.rows[0];
    }

    if (transaction.status === 'success') {
      await client.query('COMMIT');
      return getStoreSubscription(transaction.store_id);
    }

    const plan = await getPlan(transaction.plan_code, client.query.bind(client));
    if (!plan) throw new Error('Subscription plan is no longer available');
    const expectedCurrency = transaction.currency || 'NGN';
    const expectedAmount = Number(transaction.metadata?.amount || transaction.amount_ngn || plan.price_ngn);
    if (verified.currency !== expectedCurrency || Number(verified.amountNgn) < expectedAmount) {
      throw new Error('Verified payment amount or currency does not match the selected plan');
    }

    const currentResult = await client.query(
      'SELECT * FROM store_subscriptions WHERE store_id = $1 FOR UPDATE',
      [transaction.store_id]
    );
    const current = currentResult.rows[0];
    const now = new Date();
    const currentEnd = current.current_period_end ? new Date(current.current_period_end) : null;
    const periodStart = currentEnd && currentEnd > now ? currentEnd : now;
    const periodEnd = addMonths(periodStart, plan.duration_months);

    await client.query(
      `UPDATE billing_transactions SET
         provider_transaction_id = $1,
         amount_ngn = $2,
         currency = $3,
         status = 'success',
         paid_at = $4,
         metadata = metadata || $5::jsonb,
         updated_at = NOW()
       WHERE id = $6`,
      [
        verified.transactionId,
        Math.round(verified.amountNgn),
        verified.currency,
        verified.paidAt || now,
        JSON.stringify({ verified: verified.raw }),
        transaction.id,
      ]
    );

    await client.query(
      `UPDATE store_subscriptions SET
         plan_code = $1,
         status = 'active',
         provider = $2,
         current_period_start = $3,
         current_period_end = GREATEST(COALESCE(current_period_end, $4), $4),
         provider_customer_id = COALESCE($5, provider_customer_id),
         provider_subscription_id = COALESCE($6, provider_subscription_id),
         provider_email_token = COALESCE($7, provider_email_token),
         cancel_at_period_end = false,
         activation_fee_paid = activation_fee_paid OR $8,
         last_verified_at = NOW(),
         metadata = metadata || $9::jsonb,
         updated_at = NOW()
       WHERE store_id = $10`,
      [
        plan.code,
        provider,
        periodStart,
        periodEnd,
        verified.providerCustomerId || null,
        verified.providerSubscriptionId || null,
        verified.providerEmailToken || null,
        plan.code === 'activation_5m',
        JSON.stringify({ last_payment_reference: verified.reference }),
        transaction.store_id,
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (store_id, entity_type, action, new_values)
       VALUES ($1, 'subscription', 'payment_verified', $2)`,
      [
        transaction.store_id,
        JSON.stringify({
          provider,
          reference: verified.reference,
          plan_code: plan.code,
          amount: Number(verified.amountNgn),
          currency: verified.currency,
          period_end: periodEnd,
        }),
      ]
    );
    await client.query('COMMIT');

    const identity = await getBillingIdentity(transaction.store_id);
    try {
      await sendBillingEmail({
        storeId: transaction.store_id,
        to: identity?.email,
        type: 'payment_success',
        key: `${provider}:${verified.reference}`,
        subject: 'QuickPOS payment received',
        heading: 'Your QuickPOS access is active',
        body: `We received your ${formatMoney(verified.amountNgn, verified.currency)} payment for the ${plan.name} plan. Your access is paid through ${periodEnd.toLocaleDateString('en-NG')}.`,
      });
    } catch (error) {
      logger.warn('Payment receipt email failed', { error: error.message });
    }

    return getStoreSubscription(transaction.store_id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markWebhookEvent(provider, req) {
  const key = eventKey(provider, req);
  const result = await query(
    `INSERT INTO billing_webhook_events (provider, event_key, event_type, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, event_key) DO NOTHING
     RETURNING id`,
    [provider, key, req.body?.event || req.body?.type || 'unknown', req.body]
  );
  if (result.rows[0]) return { id: result.rows[0].id, duplicate: false };

  const existing = await query(
    `SELECT id, status FROM billing_webhook_events
     WHERE provider = $1 AND event_key = $2`,
    [provider, key]
  );
  if (existing.rows[0]?.status === 'failed') {
    await query(
      `UPDATE billing_webhook_events
       SET status = 'received', error = NULL, processed_at = NULL, received_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id]
    );
    return { id: existing.rows[0].id, duplicate: false };
  }
  return { id: existing.rows[0]?.id, duplicate: true };
}

async function finishWebhook(id, status, error = null) {
  if (!id) return;
  await query(
    `UPDATE billing_webhook_events
     SET status = $1, error = $2, processed_at = NOW()
     WHERE id = $3`,
    [status, error, id]
  );
}

router.get('/plans', async (req, res, next) => {
  try {
    const providers = getProviderAvailability(config);
    const result = await query(
      `SELECT code, name, price_ngn, duration_months, billing_interval, recurring, is_promotional
       FROM subscription_plans WHERE is_active = true ORDER BY price_ngn`
    );
    res.json({
      plans: result.rows.map((plan) => ({
        ...plan,
        price_ngn: Number(plan.price_ngn),
        prices: Object.fromEntries(
          Object.entries(config.billingCurrencies.prices || {})
            .map(([currency, prices]) => [currency, prices[plan.code]])
            .filter(([, amount]) => Number.isFinite(Number(amount)) && Number(amount) > 0)
        ),
        available: true,
        provider_availability: getPlanProviderAvailability(config, plan),
      })),
      providers,
      currency: {
        default: 'NGN',
        prices_configured: Object.keys(config.billingCurrencies.prices || {}),
        provider_supported: config.billingCurrencies.providerSupported,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/webhooks/paystack', async (req, res) => {
  if (!config.paystack.secretKey || !verifyPaystackSignature(req)) {
    return res.status(401).json({ error: 'Invalid Paystack webhook signature' });
  }

  const event = await markWebhookEvent('paystack', req);
  if (event.duplicate) return res.sendStatus(200);

  try {
    const type = req.body?.event;
    const data = req.body?.data || {};
    if (type === 'charge.success') {
      await activateVerifiedPayment('paystack', await verifyPaystackTransaction(data.reference));
    } else if (type === 'subscription.create') {
      await query(
        `UPDATE store_subscriptions SET
           provider_subscription_id = $1,
           provider_email_token = $2,
           provider_customer_id = COALESCE($3, provider_customer_id),
           updated_at = NOW()
         WHERE provider = 'paystack'
           AND (
             provider_customer_id = $3
             OR metadata->>'last_payment_reference' = $4
           )`,
        [data.subscription_code, data.email_token, data.customer?.customer_code, data.reference || '']
      );
    } else if (['invoice.payment_failed', 'charge.failed'].includes(type)) {
      const failed = await query(
        `UPDATE store_subscriptions SET status = 'past_due', last_verified_at = NOW(), updated_at = NOW()
         WHERE provider = 'paystack'
           AND (
             provider_subscription_id = $1
             OR provider_customer_id = $2
           )
         RETURNING store_id, current_period_end`,
        [data.subscription?.subscription_code || data.subscription_code || '', data.customer?.customer_code || '']
      );
      for (const row of failed.rows) {
        const identity = await getBillingIdentity(row.store_id);
        await sendBillingEmail({
          storeId: row.store_id,
          to: identity?.email,
          type: 'renewal_failed',
          key: `${type}:${data.id || data.reference || event.id}`,
          subject: 'QuickPOS renewal payment failed',
          heading: 'We could not renew QuickPOS',
          body: row.current_period_end
            ? `Your store keeps access through ${new Date(row.current_period_end).toLocaleDateString('en-NG')}. Update your payment authorization before then to avoid read-only mode.`
            : 'Open QuickPOS billing to choose a plan and restore access.',
        });
      }
    } else if (['subscription.disable', 'subscription.not_renew'].includes(type)) {
      await query(
        `UPDATE store_subscriptions
         SET status = 'cancelled', cancel_at_period_end = true, last_verified_at = NOW(), updated_at = NOW()
         WHERE provider = 'paystack' AND provider_subscription_id = $1`,
        [data.subscription_code]
      );
    }
    await finishWebhook(event.id, 'processed');
    return res.sendStatus(200);
  } catch (error) {
    logger.error('Paystack webhook failed', { error: error.message });
    await finishWebhook(event.id, 'failed', error.message);
    return res.sendStatus(500);
  }
});

router.post('/webhooks/flutterwave', async (req, res) => {
  if (!config.flutterwave.webhookSecret || !verifyFlutterwaveSignature(req)) {
    return res.status(401).json({ error: 'Invalid Flutterwave webhook signature' });
  }

  const event = await markWebhookEvent('flutterwave', req);
  if (event.duplicate) return res.sendStatus(200);

  try {
    const type = req.body?.event || req.body?.type;
    const data = req.body?.data || {};
    if (
      ['charge.completed', 'charge.successful'].includes(type) &&
      ['successful', 'succeeded'].includes(data.status)
    ) {
      await activateVerifiedPayment('flutterwave', await verifyFlutterwaveTransaction(data.id));
    } else if (type?.includes('failed')) {
      const failed = await query(
        `UPDATE store_subscriptions SET status = 'past_due', last_verified_at = NOW(), updated_at = NOW()
         WHERE provider = 'flutterwave' AND provider_subscription_id = $1
         RETURNING store_id, current_period_end`,
        [String(data.subscription_id || '')]
      );
      for (const row of failed.rows) {
        const identity = await getBillingIdentity(row.store_id);
        await sendBillingEmail({
          storeId: row.store_id,
          to: identity?.email,
          type: 'renewal_failed',
          key: `${type}:${data.id || event.id}`,
          subject: 'QuickPOS renewal payment failed',
          heading: 'We could not renew QuickPOS',
          body: row.current_period_end
            ? `Your store keeps access through ${new Date(row.current_period_end).toLocaleDateString('en-NG')}. Update billing before then to avoid read-only mode.`
            : 'Open QuickPOS billing to choose a plan and restore access.',
        });
      }
    } else if (type?.includes('cancel')) {
      await query(
        `UPDATE store_subscriptions
         SET status = 'cancelled', cancel_at_period_end = true, last_verified_at = NOW(), updated_at = NOW()
         WHERE provider = 'flutterwave' AND provider_subscription_id = $1`,
        [String(data.id || data.subscription_id || '')]
      );
    }
    await finishWebhook(event.id, 'processed');
    return res.sendStatus(200);
  } catch (error) {
    logger.error('Flutterwave webhook failed', { error: error.message });
    await finishWebhook(event.id, 'failed', error.message);
    return res.sendStatus(500);
  }
});

router.use(authenticate);

router.get('/status', async (req, res, next) => {
  try {
    const subscription = await getStoreSubscription(req.user.store_id);
    const activationEligible = await initialActivationEligible(req.user.store_id, subscription);
    res.json({ subscription, initial_activation_eligible: activationEligible });
  } catch (error) {
    next(error);
  }
});

router.post('/checkout', authorize('admin'), async (req, res, next) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Choose a valid provider and plan',
      });
    }

    const {
      provider,
      plan_code: planCode,
      currency: requestedCurrency,
      locale,
      time_zone: timeZone,
      country,
    } = parsed.data;
    const plan = await getPlan(planCode);
    const subscription = await getStoreSubscription(req.user.store_id);
    const providers = getProviderAvailability(config);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (!providers[provider].plans[planCode]) {
      return res.status(503).json({
        error: `${provider === 'paystack' ? 'Paystack' : 'Flutterwave'} checkout is not configured for this plan`,
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      });
    }
    const activationEligible = await initialActivationEligible(req.user.store_id, subscription);
    if (subscription.activation_required && planCode !== 'activation_5m') {
      return res.status(403).json({
        error: 'Complete the ₦20,000 initial activation before choosing a renewal plan',
        code: 'INITIAL_ACTIVATION_REQUIRED',
      });
    }
    if (planCode === 'activation_5m' && !activationEligible) {
      return res.status(403).json({
        error: 'Initial activation has already been completed for this store',
        code: 'INITIAL_ACTIVATION_ALREADY_PAID',
      });
    }
    const currentEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
    if (
      plan.recurring &&
      subscription.can_write &&
      currentEnd?.getTime() > Date.now() &&
      subscription.provider
    ) {
      return res.status(409).json({
        error: subscription.plan_code === planCode && subscription.provider === provider
          ? 'This recurring plan is already active'
          : `Plan or provider changes can begin after ${currentEnd.toLocaleDateString('en-NG')}. No prorated change was made.`,
        code: 'PLAN_CHANGE_AFTER_CURRENT_TERM',
        available_after: currentEnd.toISOString(),
      });
    }
    const checkoutCurrency = preferredCurrencyForRequest(
      config,
      provider,
      plan,
      requestedCurrency,
      locale || req.get('accept-language') || '',
      {
        country:
          country ||
          req.get('x-vercel-ip-country') ||
          req.get('cf-ipcountry') ||
          req.get('x-country-code') ||
          '',
        timeZone,
      }
    );
    if (!checkoutCurrency) {
      return res.status(503).json({
        error: 'No supported payment currency is configured for this provider and plan',
        code: 'PAYMENT_CURRENCY_UNAVAILABLE',
      });
    }
    const checkoutAmount = checkoutAmountForPlan(plan, checkoutCurrency, config.billingCurrencies.prices);
    if (checkoutAmount == null) {
      return res.status(503).json({
        error: `${checkoutCurrency} pricing is not configured for this plan`,
        code: 'PAYMENT_CURRENCY_UNAVAILABLE',
      });
    }
    if (requestedCurrency && requestedCurrency !== checkoutCurrency) {
      logger.info('Checkout currency fell back to supported provider currency', {
        requestedCurrency,
        checkoutCurrency,
        provider,
        planCode,
      });
    }

    if (plan.recurring && !providerPlanId(provider, planCode, checkoutCurrency)) {
      return res.status(503).json({ error: `${provider} is not configured for this plan yet` });
    }

    const identity = await getBillingIdentity(req.user.store_id);
    if (!identity?.email) return res.status(400).json({ error: 'Add a store owner email before checkout' });
    const reference = `QP-${req.user.store_id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const metadata = {
      store_id: req.user.store_id,
      plan_code: planCode,
      reference,
      currency: checkoutCurrency,
      amount: checkoutAmount,
      base_price_ngn: Number(plan.price_ngn),
      legal_acknowledgement: {
        terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
        refund_version: LEGAL_DOCUMENT_VERSIONS.refund,
        acknowledged_at: new Date().toISOString(),
      },
    };
    await recordLegalAcceptances({ query }, {
      userId: req.user.id,
      storeId: req.user.store_id,
      documents: ['terms', 'refund'],
      context: 'checkout',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    await query(
      `INSERT INTO billing_transactions
       (store_id, provider, provider_reference, plan_code, amount_ngn, currency, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.store_id, provider, reference, planCode, Math.round(checkoutAmount), checkoutCurrency, metadata]
    );

    let authorizationUrl;
    if (provider === 'paystack') {
      const payload = {
        email: identity.email,
        amount: Math.round(Number(checkoutAmount) * 100),
        currency: checkoutCurrency,
        reference,
        callback_url: config.billing.checkoutReturnUrl,
        metadata,
      };
      if (plan.recurring) payload.plan = providerPlanId(provider, planCode, checkoutCurrency);
      let response;
      try {
        response = await axios.post('https://api.paystack.co/transaction/initialize', payload, {
          headers: { Authorization: `Bearer ${config.paystack.secretKey}` },
        });
      } catch (error) {
        throw providerError(error, 'Paystack');
      }
      authorizationUrl = response.data?.data?.authorization_url;
    } else {
      const payload = {
        tx_ref: reference,
        amount: Number(checkoutAmount),
        currency: checkoutCurrency,
        redirect_url: config.billing.checkoutReturnUrl,
        customer: { email: identity.email, name: identity.name },
        customizations: { title: 'QuickPOS subscription', description: `${plan.name} plan` },
        meta: metadata,
      };
      if (plan.recurring) payload.payment_plan = Number(providerPlanId(provider, planCode, checkoutCurrency));
      let response;
      try {
        response = await axios.post('https://api.flutterwave.com/v3/payments', payload, {
          headers: { Authorization: `Bearer ${config.flutterwave.secretKey}` },
        });
      } catch (error) {
        throw providerError(error, 'Flutterwave');
      }
      authorizationUrl = response.data?.data?.link;
    }

    if (!authorizationUrl) throw new Error(`${provider} did not return a checkout URL`);
    res.status(201).json({
      authorization_url: authorizationUrl,
      reference,
      provider,
      plan_code: planCode,
      currency: checkoutCurrency,
      amount: checkoutAmount,
      currency_notice: currencyDisclosure(checkoutCurrency, requestedCurrency),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cancel', authorize('admin'), async (req, res, next) => {
  try {
    const subscriptionResult = await query(
      `SELECT ss.*, sp.recurring
       FROM store_subscriptions ss
       LEFT JOIN subscription_plans sp ON sp.code = ss.plan_code
       WHERE ss.store_id = $1`,
      [req.user.store_id]
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription || !subscription.provider) {
      return res.status(400).json({ error: 'There is no recurring subscription to cancel' });
    }
    if (!subscription.recurring) {
      return res.status(400).json({ error: 'This plan does not renew automatically' });
    }
    if (!subscription.provider_subscription_id) {
      return res.status(409).json({
        error: 'The provider is still creating this subscription. Try cancelling again in a few minutes.',
        code: 'SUBSCRIPTION_PROVIDER_PENDING',
      });
    }

    if (subscription.provider === 'paystack') {
      try {
        await axios.post(
          'https://api.paystack.co/subscription/disable',
          {
            code: subscription.provider_subscription_id,
            token: subscription.provider_email_token,
          },
          { headers: { Authorization: `Bearer ${config.paystack.secretKey}` } }
        );
      } catch (error) {
        throw providerError(error, 'Paystack', 'Subscription cancellation failed');
      }
    } else if (subscription.provider === 'flutterwave') {
      try {
        await axios.put(
          `https://api.flutterwave.com/v3/subscriptions/${encodeURIComponent(subscription.provider_subscription_id)}/cancel`,
          {},
          { headers: { Authorization: `Bearer ${config.flutterwave.secretKey}` } }
        );
      } catch (error) {
        throw providerError(error, 'Flutterwave', 'Subscription cancellation failed');
      }
    }

    await query(
      `UPDATE store_subscriptions
       SET status = 'cancelled', cancel_at_period_end = true, last_verified_at = NOW(), updated_at = NOW()
       WHERE store_id = $1`,
      [req.user.store_id]
    );
    const identity = await getBillingIdentity(req.user.store_id);
    await sendBillingEmail({
      storeId: req.user.store_id,
      to: identity?.email,
      type: 'subscription_cancelled',
      key: subscription.current_period_end || new Date().toISOString().slice(0, 10),
      subject: 'QuickPOS renewal cancelled',
      heading: 'Automatic renewal is cancelled',
      body: subscription.current_period_end
        ? `Your store keeps access through ${new Date(subscription.current_period_end).toLocaleDateString('en-NG')}.`
        : 'Your store will not be charged again.',
    });
    res.json({ subscription: await getStoreSubscription(req.user.store_id) });
  } catch (error) {
    next(error);
  }
});

router.get('/transactions', authorize('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, provider, provider_reference, provider_transaction_id, plan_code,
              amount_ngn, currency, status, paid_at, created_at
       FROM billing_transactions
       WHERE store_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.store_id]
    );
    res.json({ transactions: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/audit', authorize('admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, action, new_values, created_at
       FROM audit_logs
       WHERE store_id = $1 AND entity_type = 'subscription'
       ORDER BY created_at DESC LIMIT 100`,
      [req.user.store_id]
    );
    res.json({ events: result.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
