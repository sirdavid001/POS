import crypto from 'crypto';
import { availableCurrenciesForPlan } from './currency.js';

const RECURRING_PLAN_CODES = ['monthly', 'quarterly', 'yearly'];

export function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyPaystackWebhook(rawBody, signature, secretKey) {
  if (!secretKey || !signature) return false;
  const expected = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
}

export function verifyFlutterwaveWebhook(rawBody, signature, secretHash) {
  if (!secretHash || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secretHash)
    .update(rawBody)
    .digest('base64');
  return safeEqual(expected, signature) || safeEqual(secretHash, signature);
}

export function getProviderAvailability(config) {
  const paystackConfigured = Boolean(config.paystack.secretKey);
  const flutterwaveConfigured = Boolean(
    config.flutterwave.secretKey && config.flutterwave.webhookSecret
  );

  const buildPlanAvailability = (provider, configured) => ({
    activation_5m: configured,
    ...Object.fromEntries(RECURRING_PLAN_CODES.map((code) => [
      code,
      configured && Boolean(config[provider].plans[code]),
    ])),
  });

  const paystackPlans = buildPlanAvailability('paystack', paystackConfigured);
  const flutterwavePlans = buildPlanAvailability('flutterwave', flutterwaveConfigured);

  return {
    paystack: {
      configured: paystackConfigured,
      webhook_configured: paystackConfigured,
      plans: paystackPlans,
      available: Object.values(paystackPlans).some(Boolean),
    },
    flutterwave: {
      configured: Boolean(config.flutterwave.secretKey),
      webhook_configured: Boolean(config.flutterwave.webhookSecret),
      plans: flutterwavePlans,
      available: Object.values(flutterwavePlans).some(Boolean),
    },
  };
}

export function getPlanProviderAvailability(config, plan) {
  const providers = getProviderAvailability(config);
  return {
    paystack: Boolean(providers.paystack.plans[plan.code]),
    flutterwave: Boolean(providers.flutterwave.plans[plan.code]),
    currencies: {
      paystack: providers.paystack.plans[plan.code]
        ? availableCurrenciesForPlan(config, 'paystack', plan)
        : [],
      flutterwave: providers.flutterwave.plans[plan.code]
        ? availableCurrenciesForPlan(config, 'flutterwave', plan)
        : [],
    },
  };
}

export function providerError(error, provider, fallback = 'Payment provider request failed') {
  const message =
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    fallback;
  const wrapped = new Error(`${provider} could not complete the request: ${message}`);
  wrapped.statusCode = error.response?.status >= 400 && error.response?.status < 500 ? 400 : 502;
  wrapped.code = 'PAYMENT_PROVIDER_ERROR';
  return wrapped;
}
