import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const planDefinitions = [
  {
    code: 'monthly',
    name: 'QuickPOS Monthly',
    amountNgn: 5000,
    paystackInterval: 'monthly',
    flutterwaveInterval: 'monthly',
  },
  {
    code: 'quarterly',
    name: 'QuickPOS Quarterly',
    amountNgn: 13500,
    paystackInterval: 'quarterly',
    flutterwaveInterval: 'quarterly',
  },
  {
    code: 'yearly',
    name: 'QuickPOS Yearly',
    amountNgn: 50000,
    paystackInterval: 'annually',
    flutterwaveInterval: 'yearly',
  },
];

function apiError(provider, response, body) {
  const message = body?.message || body?.error || `${response.status} ${response.statusText}`;
  return new Error(`${provider}: ${message}`);
}

async function providerRequest(provider, url, secretKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === false) throw apiError(provider, response, body);
  return body;
}

async function configurePaystack(secretKey) {
  const listed = await providerRequest(
    'Paystack',
    'https://api.paystack.co/plan?perPage=100',
    secretKey
  );
  const existing = listed.data || [];
  const values = {};

  for (const plan of planDefinitions) {
    const match = existing.find((item) =>
      item.currency === 'NGN' &&
      Number(item.amount) === plan.amountNgn * 100 &&
      item.interval === plan.paystackInterval &&
      item.name === plan.name
    );
    const result = match || (await providerRequest(
      'Paystack',
      'https://api.paystack.co/plan',
      secretKey,
      {
        method: 'POST',
        body: JSON.stringify({
          name: plan.name,
          amount: plan.amountNgn * 100,
          interval: plan.paystackInterval,
          currency: 'NGN',
          description: `QuickPOS ${plan.code} store subscription`,
          send_invoices: true,
          send_sms: false,
        }),
      }
    )).data;
    values[`PAYSTACK_PLAN_${plan.code.toUpperCase()}`] = result.plan_code;
  }

  return values;
}

async function configureFlutterwave(secretKey) {
  const listed = await providerRequest(
    'Flutterwave',
    'https://api.flutterwave.com/v3/payment-plans',
    secretKey
  );
  const existing = listed.data || [];
  const values = {};

  for (const plan of planDefinitions) {
    const match = existing.find((item) =>
      item.currency === 'NGN' &&
      Number(item.amount) === plan.amountNgn &&
      item.interval?.toLowerCase() === plan.flutterwaveInterval &&
      item.name === plan.name &&
      item.status === 'active'
    );
    const result = match || (await providerRequest(
      'Flutterwave',
      'https://api.flutterwave.com/v3/payment-plans',
      secretKey,
      {
        method: 'POST',
        body: JSON.stringify({
          name: plan.name,
          amount: plan.amountNgn,
          interval: plan.flutterwaveInterval,
          currency: 'NGN',
        }),
      }
    )).data;
    values[`FLUTTERWAVE_PLAN_${plan.code.toUpperCase()}`] = String(result.id);
  }

  return values;
}

async function writeEnvFile(filename, values) {
  const target = path.resolve(process.cwd(), filename);
  const original = await fs.readFile(target, 'utf8').catch(() => '');
  let next = original;
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    next = pattern.test(next) ? next.replace(pattern, line) : `${next.trimEnd()}\n${line}\n`;
  }
  await fs.writeFile(target, next);
}

const requestedProvider = process.argv.find((arg) => arg.startsWith('--provider='))
  ?.split('=')[1] || 'all';
const writeTarget = process.argv.find((arg) => arg.startsWith('--write='))
  ?.split('=')[1];
const values = {};
const failures = [];

if (['all', 'paystack'].includes(requestedProvider)) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    failures.push('Paystack: PAYSTACK_SECRET_KEY is missing');
  } else {
    try {
      Object.assign(values, await configurePaystack(process.env.PAYSTACK_SECRET_KEY));
    } catch (error) {
      failures.push(error.message);
    }
  }
}

if (['all', 'flutterwave'].includes(requestedProvider)) {
  if (!process.env.FLUTTERWAVE_SECRET_KEY) {
    failures.push('Flutterwave: FLUTTERWAVE_SECRET_KEY is missing');
  } else {
    try {
      Object.assign(values, await configureFlutterwave(process.env.FLUTTERWAVE_SECRET_KEY));
    } catch (error) {
      failures.push(error.message);
    }
  }
}

if (writeTarget && Object.keys(values).length) {
  await writeEnvFile(writeTarget, values);
  console.log(`Updated ${writeTarget} with provider plan identifiers.`);
} else {
  for (const [name, value] of Object.entries(values)) console.log(`${name}=${value}`);
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
