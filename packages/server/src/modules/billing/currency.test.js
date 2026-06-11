import { describe, expect, test } from '@jest/globals';
import {
  availableCurrenciesForPlan,
  currencyFromCountry,
  currencyFromLocale,
  currencyFromTimeZone,
  preferredCurrencyForRequest,
} from './currency.js';

const activationPlan = {
  code: 'activation_5m',
  price_ngn: 20000,
  recurring: false,
};

const monthlyPlan = {
  code: 'monthly',
  price_ngn: 5000,
  recurring: true,
};

function config(overrides = {}) {
  return {
    paystack: {
      plans: { monthly: 'PLN_monthly', quarterly: '', yearly: '' },
      plansByCurrency: {},
    },
    flutterwave: {
      plans: { monthly: '1', quarterly: '', yearly: '' },
      plansByCurrency: {},
    },
    billingCurrencies: {
      prices: {
        NGN: { activation_5m: 20000, monthly: 5000 },
        USD: { activation_5m: 15, monthly: 4 },
      },
      providerSupported: {
        paystack: ['NGN', 'USD'],
        flutterwave: ['NGN', 'USD', 'EUR'],
      },
    },
    ...overrides,
  };
}

describe('billing currency selection', () => {
  test('maps locale country hints to payment currencies', () => {
    expect(currencyFromLocale('en-US')).toBe('USD');
    expect(currencyFromLocale('en-NG')).toBe('NGN');
    expect(currencyFromLocale('fr-CI')).toBe('XOF');
    expect(currencyFromLocale('en-GB')).toBe('USD');
    expect(currencyFromLocale('fr-FR')).toBe('USD');
    expect(currencyFromLocale('en-US,en;q=0.9')).toBe('USD');
  });

  test('maps country and timezone hints to regional currencies with USD outside the region', () => {
    expect(currencyFromCountry('NG')).toBe('NGN');
    expect(currencyFromCountry('DE')).toBe('USD');
    expect(currencyFromTimeZone('Africa/Lagos')).toBe('NGN');
    expect(currencyFromTimeZone('Africa/Accra')).toBe('GHS');
    expect(currencyFromTimeZone('Europe/London')).toBe('USD');
  });

  test('allows non-recurring activation in a configured supported currency', () => {
    expect(availableCurrenciesForPlan(config(), 'paystack', activationPlan)).toEqual(['NGN', 'USD']);
    expect(preferredCurrencyForRequest(config(), 'paystack', activationPlan, 'USD', 'en-US')).toBe('USD');
  });

  test('keeps recurring non-NGN unavailable without currency-specific provider plan IDs', () => {
    expect(availableCurrenciesForPlan(config(), 'paystack', monthlyPlan)).toEqual(['NGN']);
  });

  test('prefers USD when requested currency is unavailable and location is outside regional currencies', () => {
    expect(preferredCurrencyForRequest(config(), 'paystack', activationPlan, 'EUR', 'en-GB')).toBe('USD');
    expect(preferredCurrencyForRequest(config(), 'paystack', activationPlan, undefined, 'fr-FR')).toBe('USD');
    expect(preferredCurrencyForRequest(config(), 'paystack', activationPlan, undefined, 'en-US', {
      country: 'NG',
      timeZone: 'Africa/Lagos',
    })).toBe('NGN');
  });

  test('falls back to NGN when USD is not available for a recurring provider plan', () => {
    expect(preferredCurrencyForRequest(config(), 'paystack', monthlyPlan, 'EUR', 'en-US')).toBe('NGN');
  });

  test('returns null when no provider-supported configured currency is available', () => {
    expect(preferredCurrencyForRequest(config({
      billingCurrencies: {
        prices: { NGN: { activation_5m: 20000 } },
        providerSupported: {
          paystack: ['USD'],
          flutterwave: ['USD'],
        },
      },
    }), 'paystack', activationPlan, 'NGN', 'en-NG')).toBeNull();
  });
});
