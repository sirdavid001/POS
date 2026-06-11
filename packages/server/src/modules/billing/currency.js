const DEFAULT_CURRENCY = 'NGN';
const INTERNATIONAL_FALLBACK_CURRENCY = 'USD';

const PAYSTACK_SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GHS', 'ZAR', 'KES', 'XOF'];
const FLUTTERWAVE_SUPPORTED_CURRENCIES = [
  'GBP',
  'CAD',
  'XAF',
  'COP',
  'EGP',
  'EUR',
  'GHS',
  'KES',
  'NGN',
  'RWF',
  'SLL',
  'ZAR',
  'TZS',
  'UGX',
  'USD',
  'XOF',
  'ZMW',
];

const COUNTRY_CURRENCY = {
  NG: 'NGN',
  GH: 'GHS',
  ZA: 'ZAR',
  KE: 'KES',
  CI: 'XOF',
  BJ: 'XOF',
  BF: 'XOF',
  GW: 'XOF',
  ML: 'XOF',
  NE: 'XOF',
  SN: 'XOF',
  TG: 'XOF',
  US: 'USD',
  GB: 'USD',
  CA: 'USD',
  RW: 'RWF',
  SL: 'SLL',
  TZ: 'TZS',
  UG: 'UGX',
  ZM: 'ZMW',
  CM: 'XAF',
  CF: 'XAF',
  TD: 'XAF',
  CG: 'XAF',
  GQ: 'XAF',
  GA: 'XAF',
  EG: 'EGP',
};

const TIMEZONE_CURRENCY = {
  'Africa/Lagos': 'NGN',
  'Africa/Accra': 'GHS',
  'Africa/Johannesburg': 'ZAR',
  'Africa/Nairobi': 'KES',
  'Africa/Abidjan': 'XOF',
  'Africa/Porto-Novo': 'XOF',
  'Africa/Ouagadougou': 'XOF',
  'Africa/Bissau': 'XOF',
  'Africa/Bamako': 'XOF',
  'Africa/Niamey': 'XOF',
  'Africa/Dakar': 'XOF',
  'Africa/Lome': 'XOF',
  'Africa/Kigali': 'RWF',
  'Africa/Freetown': 'SLL',
  'Africa/Dar_es_Salaam': 'TZS',
  'Africa/Kampala': 'UGX',
  'Africa/Lusaka': 'ZMW',
  'Africa/Douala': 'XAF',
  'Africa/Bangui': 'XAF',
  'Africa/Ndjamena': 'XAF',
  'Africa/Brazzaville': 'XAF',
  'Africa/Malabo': 'XAF',
  'Africa/Libreville': 'XAF',
  'Africa/Cairo': 'EGP',
};

const DEFAULT_PLAN_PRICES = {
  NGN: {
    activation_5m: 20000,
    monthly: 5000,
    quarterly: 13500,
    yearly: 50000,
  },
  USD: {
    activation_5m: 15,
    monthly: 4,
    quarterly: 10,
    yearly: 38,
  },
};

export function parseCsvCurrencies(value, fallback) {
  const currencies = String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z]{3}$/.test(item));
  return currencies.length ? [...new Set(currencies)] : fallback;
}

export function parseCurrencyPrices(value) {
  if (!value) return DEFAULT_PLAN_PRICES;
  try {
    const parsed = JSON.parse(value);
    const prices = { ...DEFAULT_PLAN_PRICES };
    Object.entries(parsed || {}).forEach(([currency, planPrices]) => {
      const code = currency.toUpperCase();
      if (!/^[A-Z]{3}$/.test(code) || typeof planPrices !== 'object') return;
      prices[code] = {
        ...(prices[code] || {}),
        ...Object.fromEntries(
          Object.entries(planPrices)
            .map(([planCode, amount]) => [planCode, Number(amount)])
            .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
        ),
      };
    });
    return prices;
  } catch {
    return DEFAULT_PLAN_PRICES;
  }
}

export function parseCurrencyPlanIds(providerPrefix, env = process.env) {
  const currencies = {};
  ['monthly', 'quarterly', 'yearly'].forEach((planCode) => {
    Object.entries(env).forEach(([key, value]) => {
      const pattern = new RegExp(`^${providerPrefix}_PLAN_${planCode.toUpperCase()}_([A-Z]{3})$`);
      const match = key.match(pattern);
      if (!match || !value) return;
      const currency = match[1];
      currencies[currency] = {
        ...(currencies[currency] || {}),
        [planCode]: value,
      };
    });
  });
  return currencies;
}

export function getDefaultProviderCurrencies(env = process.env) {
  return {
    paystack: parseCsvCurrencies(env.PAYSTACK_SUPPORTED_CURRENCIES, PAYSTACK_SUPPORTED_CURRENCIES),
    flutterwave: parseCsvCurrencies(env.FLUTTERWAVE_SUPPORTED_CURRENCIES, FLUTTERWAVE_SUPPORTED_CURRENCIES),
  };
}

function countryFromLocale(locale = '') {
  const candidates = String(locale || '')
    .split(',')
    .map((item) => item.split(';')[0].trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate.replace('_', '-');
    try {
      const region = new Intl.Locale(normalized).region;
      if (region) return region.toUpperCase();
    } catch {
      // Fall through to a small parser for non-standard locale hints.
    }

    const region = normalized
      .split('-')
      .slice(1)
      .find((part) => /^[A-Z]{2}$/i.test(part));
    if (region) return region.toUpperCase();
  }

  return null;
}

export function currencyFromCountry(country = '') {
  const code = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return INTERNATIONAL_FALLBACK_CURRENCY;
  return COUNTRY_CURRENCY[code] || INTERNATIONAL_FALLBACK_CURRENCY;
}

export function currencyFromLocale(locale = '') {
  const country = countryFromLocale(locale);
  return country ? currencyFromCountry(country) : INTERNATIONAL_FALLBACK_CURRENCY;
}

export function currencyFromTimeZone(timeZone = '') {
  const normalized = String(timeZone || '').trim();
  if (!normalized) return null;
  return TIMEZONE_CURRENCY[normalized] || INTERNATIONAL_FALLBACK_CURRENCY;
}

export function checkoutAmountForPlan(plan, currency, configuredPrices = DEFAULT_PLAN_PRICES) {
  const code = currency?.toUpperCase() || DEFAULT_CURRENCY;
  if (code === DEFAULT_CURRENCY) return Number(plan.price_ngn);
  const amount = configuredPrices[code]?.[plan.code];
  return Number.isFinite(Number(amount)) && Number(amount) > 0 ? Number(amount) : null;
}

export function providerSupportsCurrency(config, provider, currency) {
  return Boolean(config.billingCurrencies?.providerSupported?.[provider]?.includes(currency));
}

export function providerPlanIdForCurrency(config, provider, planCode, currency) {
  if (currency === DEFAULT_CURRENCY) return config[provider]?.plans?.[planCode] || '';
  return config[provider]?.plansByCurrency?.[currency]?.[planCode] || '';
}

export function planCurrencyAvailable(config, provider, plan, currency) {
  if (!providerSupportsCurrency(config, provider, currency)) return false;
  if (checkoutAmountForPlan(plan, currency, config.billingCurrencies?.prices) == null) return false;
  if (plan.recurring && !providerPlanIdForCurrency(config, provider, plan.code, currency)) return false;
  return true;
}

export function availableCurrenciesForPlan(config, provider, plan) {
  return (config.billingCurrencies?.providerSupported?.[provider] || [])
    .filter((currency) => planCurrencyAvailable(config, provider, plan, currency));
}

export function preferredCurrencyForRequest(config, provider, plan, requestedCurrency, locale, options = {}) {
  const candidates = [
    requestedCurrency?.toUpperCase(),
    options.country ? currencyFromCountry(options.country) : null,
    options.timeZone ? currencyFromTimeZone(options.timeZone) : null,
    currencyFromLocale(locale),
    INTERNATIONAL_FALLBACK_CURRENCY,
    DEFAULT_CURRENCY,
  ].filter(Boolean);

  return [...new Set(candidates)].find((currency) => planCurrencyAvailable(config, provider, plan, currency)) ||
    availableCurrenciesForPlan(config, provider, plan)[0] ||
    null;
}

export function currencyDisclosure(currency, requestedCurrency) {
  if (!requestedCurrency || requestedCurrency.toUpperCase() === currency) return null;
  return `Requested currency ${requestedCurrency.toUpperCase()} is not available for this provider and plan. Checkout will use ${currency}.`;
}

export { DEFAULT_CURRENCY, INTERNATIONAL_FALLBACK_CURRENCY };
