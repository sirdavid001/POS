import { track } from '@vercel/analytics';
import { renderReleaseDownloads } from './downloads.js';
import { resolveApiBase } from '../../shared/src/api.js';

const SITE_KEYS = {
  accessToken: 'quickpos_site_access_token',
  refreshToken: 'quickpos_site_refresh_token',
  user: 'quickpos_site_user',
};

const root = document.querySelector('[data-account-root]');
let activationPoll = null;

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, {
  development: import.meta.env.DEV,
});

class SiteApi {
  constructor() {
    this.accessToken = localStorage.getItem(SITE_KEYS.accessToken);
    this.refreshToken = localStorage.getItem(SITE_KEYS.refreshToken);
  }

  setSession(data) {
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    localStorage.setItem(SITE_KEYS.accessToken, data.accessToken);
    localStorage.setItem(SITE_KEYS.refreshToken, data.refreshToken);
    localStorage.setItem(SITE_KEYS.user, JSON.stringify(data.user));
  }

  updateUser(user) {
    localStorage.setItem(SITE_KEYS.user, JSON.stringify(user));
  }

  clearSession() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem(SITE_KEYS.accessToken);
    localStorage.removeItem(SITE_KEYS.refreshToken);
    localStorage.removeItem(SITE_KEYS.user);
  }

  async refreshAccessToken() {
    if (!this.refreshToken) return false;
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!response.ok) return false;
      const data = await response.json();
      this.accessToken = data.accessToken;
      localStorage.setItem(SITE_KEYS.accessToken, data.accessToken);
      return true;
    } catch {
      return false;
    }
  }

  async request(method, path, data = null) {
    const config = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (this.accessToken) {
      config.headers.Authorization = `Bearer ${this.accessToken}`;
    }
    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }

    let response = await fetch(`${API_BASE}${path}`, config);
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
        response = await fetch(`${API_BASE}${path}`, config);
      } else {
        this.clearSession();
      }
    }

    let json = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }

    if (!response.ok) {
      const details = Array.isArray(json.details)
        ? ` ${json.details.map((item) => item.message).join(' ')}`
        : '';
      throw new Error(`${json.error || `Request failed with HTTP ${response.status}`}${details}`);
    }

    return json;
  }

  get(path) { return this.request('GET', path); }
  post(path, data) { return this.request('POST', path, data); }
  patch(path, data) { return this.request('PATCH', path, data); }
}

const siteApi = new SiteApi();
const PAYMENT_CURRENCY_KEY = 'quickpos_site_payment_currency';

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
  GB: 'GBP',
  CA: 'CAD',
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

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currencyFromLocale(locale = navigator.language || '') {
  const country = String(locale)
    .replace('_', '-')
    .split('-')
    .filter((part) => /^[A-Z]{2}$/i.test(part))
    .at(-1)
    ?.toUpperCase();
  return country ? COUNTRY_CURRENCY[country] : null;
}

function detectPreferredCurrency(availableCurrencies = ['NGN']) {
  const saved = localStorage.getItem(PAYMENT_CURRENCY_KEY);
  const localCurrency = currencyFromLocale();
  return [saved, localCurrency, 'NGN']
    .filter(Boolean)
    .map((currency) => currency.toUpperCase())
    .find((currency) => availableCurrencies.includes(currency)) || availableCurrencies[0] || 'NGN';
}

function formatCurrency(value, currency = 'NGN') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function routeInfo() {
  const rawHash = window.location.hash.replace(/^#\/?/, '');
  const [mode = '', hashQuery = ''] = rawHash.split('?');
  const params = new URLSearchParams(hashQuery || window.location.search.slice(1));
  if (window.location.search) {
    new URLSearchParams(window.location.search).forEach((value, key) => params.set(key, value));
  }
  return { mode: mode || '', params };
}

function setFlash(message, type = 'info') {
  const target = document.querySelector('[data-account-alert]');
  if (!target) return;
  target.innerHTML = message
    ? `<div class="account-alert ${type}">${escapeHtml(message)}</div>`
    : '';
}

function renderAuthShell({ eyebrow, title, copy, form, footer }) {
  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell account-auth-grid">
        <div class="page-intro">
          <span class="eyebrow">${eyebrow}</span>
          <h1>${title}</h1>
          <p>${copy}</p>
          <div class="trust-row">
            <span>One QuickPOS account</span>
            <span>Same login in the POS app</span>
            <span>Admin billing portal</span>
          </div>
        </div>
        <article class="account-auth-card">
          <img src="/brand/quickpos-mark.svg" alt="" width="52" height="52">
          <div data-account-alert></div>
          ${form}
          <div class="account-auth-footer">${footer}</div>
        </article>
      </div>
    </section>
  `;
}

function renderSignIn() {
  renderAuthShell({
    eyebrow: 'Owner portal',
    title: 'Sign in to manage your store account.',
    copy: 'Use the same email address and password on this website and in the QuickPOS app. Both connect to the same store account, subscription, and database.',
    form: `
      <form class="account-form" id="site-login-form">
        <label>Email address<input name="email" type="email" autocomplete="email" required placeholder="owner@yourstore.com"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required placeholder="Your password"></label>
        <button class="button" type="submit" id="site-login-submit">Sign in</button>
      </form>
    `,
    footer: `
      <a href="#create">Create store account</a>
      <span>·</span>
      <a href="#forgot-password">Forgot password?</a>
    `,
  });

  document.getElementById('site-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('site-login-submit');
    const form = new FormData(event.target);
    button.disabled = true;
    button.textContent = 'Signing in...';
    try {
      const data = await siteApi.post('/auth/login', {
        email: form.get('email'),
        password: form.get('password'),
      });
      if (data.user?.role !== 'admin') {
        try {
          await siteApi.post('/auth/logout', { refreshToken: data.refreshToken });
        } catch {
          // The website session is still cleared locally below.
        }
        siteApi.clearSession();
        renderAdminOnly();
        return;
      }
      siteApi.setSession(data);
      window.location.hash = '#portal';
      await loadPortal('Signed in successfully.');
    } catch (error) {
      setFlash(error.message || 'Could not sign in', 'error');
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
}

function renderRegister() {
  renderAuthShell({
    eyebrow: 'Create account',
    title: 'Set up your store before downloading the app.',
    copy: 'Create the owner/admin account here, complete activation, then choose the correct app download for your device.',
    form: `
      <form class="account-form" id="site-register-form">
        <label>Store name<input name="store_name" type="text" minlength="2" required placeholder="Your store name"></label>
        <label>Owner name<input name="name" type="text" required placeholder="Full name"></label>
        <label>Email address<input name="email" type="email" autocomplete="email" required placeholder="owner@yourstore.com"></label>
        <label>Phone<input name="phone" type="tel" autocomplete="tel" placeholder="+234..."></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
        <label class="account-check">
          <input type="checkbox" name="consent" required>
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and acknowledge the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
        </label>
        <button class="button" type="submit" id="site-register-submit">Create account</button>
      </form>
    `,
    footer: 'Already have an account? <a href="#signin">Sign in</a>',
  });

  document.getElementById('site-register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('site-register-submit');
    const form = new FormData(event.target);
    const email = form.get('email');
    const password = form.get('password');
    button.disabled = true;
    button.textContent = 'Creating...';

    try {
      await siteApi.post('/auth/register', {
        store_name: form.get('store_name'),
        name: form.get('name'),
        email,
        phone: form.get('phone') || undefined,
        password,
        terms_accepted: true,
        privacy_acknowledged: true,
      });
      const data = await siteApi.post('/auth/login', { email, password });
      siteApi.setSession(data);
      window.location.hash = '#portal';
      await loadPortal('Store account created. Complete activation to unlock downloads.');
    } catch (error) {
      setFlash(error.message || 'Could not create account', 'error');
      button.disabled = false;
      button.textContent = 'Create account';
    }
  });
}

function renderForgotPassword() {
  renderAuthShell({
    eyebrow: 'Password reset',
    title: 'Get a secure reset link.',
    copy: 'Enter the email used for your QuickPOS account. If it exists, we will send a reset link.',
    form: `
      <form class="account-form" id="site-forgot-form">
        <label>Email address<input name="email" type="email" autocomplete="email" required placeholder="owner@yourstore.com"></label>
        <button class="button" type="submit" id="site-forgot-submit">Send reset link</button>
      </form>
    `,
    footer: '<a href="#signin">Back to sign in</a>',
  });

  document.getElementById('site-forgot-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('site-forgot-submit');
    const form = new FormData(event.target);
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      const result = await siteApi.post('/auth/forgot-password', {
        email: form.get('email'),
      });
      setFlash(result.message, 'success');
      event.target.reset();
    } catch (error) {
      setFlash(error.message || 'Could not request reset link', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Send reset link';
    }
  });
}

function renderResetPassword() {
  const { params } = routeInfo();
  const token = params.get('token') || '';
  renderAuthShell({
    eyebrow: 'New password',
    title: 'Reset your QuickPOS password.',
    copy: 'Choose a new password for the same account you use on the website portal and in the POS app.',
    form: token ? `
      <form class="account-form" id="site-reset-form">
        <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
        <label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required placeholder="Repeat password"></label>
        <button class="button" type="submit" id="site-reset-submit">Reset password</button>
      </form>
    ` : `
      <div class="account-empty-panel">
        This reset link is incomplete. Request a fresh password reset email.
      </div>
    `,
    footer: token ? '<a href="#signin">Back to sign in</a>' : '<a href="#forgot-password">Request reset link</a>',
  });

  document.getElementById('site-reset-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const password = form.get('password');
    const confirmation = form.get('confirm_password');
    const button = document.getElementById('site-reset-submit');
    if (password !== confirmation) {
      setFlash('Passwords do not match.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Resetting...';
    try {
      const result = await siteApi.post('/auth/reset-password', { token, password });
      siteApi.clearSession();
      setFlash(result.message, 'success');
      setTimeout(() => {
        window.location.hash = '#signin';
        renderSignIn();
      }, 900);
    } catch (error) {
      setFlash(error.message || 'Could not reset password', 'error');
      button.disabled = false;
      button.textContent = 'Reset password';
    }
  });
}

function renderAdminOnly() {
  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell account-auth-grid">
        <div class="page-intro">
          <span class="eyebrow">Admin only</span>
          <h1>This portal is for store owners and admins.</h1>
          <p>Manager and cashier accounts should sign in only through the installed QuickPOS app. The website portal has logged this session out.</p>
          <a class="button" href="#signin">Back to website sign in</a>
        </div>
        <article class="account-auth-card account-empty-panel">
          <strong>No app preview here.</strong>
          <p>The website handles account, billing, and downloads only. POS screens stay inside the installed app.</p>
        </article>
      </div>
    </section>
  `;
}

function statusCopy(subscription) {
  if (!subscription) return 'Checking subscription status.';
  if (subscription.status === 'grandfathered') return 'Your store has full access.';
  if (subscription.activation_required) return 'Complete the one-time activation to unlock downloads and full app access.';
  if (subscription.status === 'active') return `Active through ${formatDate(subscription.current_period_end)}.`;
  if (subscription.status === 'expired') return 'Your subscription has expired. Renew before downloading the app.';
  if (subscription.cancel_at_period_end) return `Access continues through ${formatDate(subscription.current_period_end)}.`;
  return `${subscription.status || 'Subscription'} status is being checked.`;
}

function planDescription(plan) {
  if (plan.code === 'activation_5m') return 'Required once for new stores, with five months of full access';
  if (plan.code === 'monthly') return 'Flexible monthly renewal after activation';
  if (plan.code === 'quarterly') return 'Save compared with monthly billing';
  if (plan.code === 'yearly') return 'Best value for established stores';
  return 'All QuickPOS features included';
}

function downloadsUnlocked(subscription) {
  return Boolean(subscription?.can_write && !subscription?.activation_required);
}

function renderTransactions(transactions = []) {
  if (!transactions.length) {
    return '<p class="account-muted">No subscription payments yet.</p>';
  }
  return `
    <div class="account-table-wrap">
      <table class="account-table">
        <thead><tr><th>Date</th><th>Plan</th><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          ${transactions.map((transaction) => `
            <tr>
              <td>${formatDate(transaction.paid_at || transaction.created_at)}</td>
              <td>${escapeHtml(transaction.plan_code || '')}</td>
              <td>${escapeHtml(transaction.provider || '')}</td>
              <td><code>${escapeHtml(transaction.provider_reference || '')}</code></td>
              <td>${formatCurrency(transaction.amount_ngn, transaction.currency || 'NGN')}</td>
              <td><span class="account-badge ${transaction.status === 'success' ? 'success' : 'warning'}">${escapeHtml(transaction.status || '')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function currenciesForPlan(plan) {
  const currencies = plan.provider_availability?.currencies || {};
  return [...new Set([
    ...(currencies.paystack || []),
    ...(currencies.flutterwave || []),
  ])];
}

function visiblePlansForSubscription(plans = [], subscription = {}) {
  const needsActivation = Boolean(subscription.activation_required);
  const activationPeriodActive =
    subscription.plan_code === 'activation_5m' &&
    subscription.can_write;
  return plans.filter((plan) =>
    needsActivation ? plan.code === 'activation_5m' : plan.code !== 'activation_5m'
  );
}

function renderPlanCards(plans = [], providers = {}, subscription = {}) {
  const activationPeriodActive =
    subscription.plan_code === 'activation_5m' &&
    subscription.can_write;
  const visiblePlans = visiblePlansForSubscription(plans, subscription);
  const configuredProviderCount = Object.values(providers || {})
    .filter((provider) => provider.available).length;
  const availableCurrencies = [...new Set(
    visiblePlans.flatMap((plan) => currenciesForPlan(plan))
  )];
  const selectedCurrency = detectPreferredCurrency(availableCurrencies.length ? availableCurrencies : ['NGN']);

  return `
    ${configuredProviderCount === 0 ? `
      <div class="account-notice">
        Online checkout is temporarily unavailable. Contact support for activation assistance.
      </div>
    ` : ''}
    ${activationPeriodActive ? `
      <div class="account-notice">
        Your five-month activation period is active through ${formatDate(subscription.current_period_end)}.
        Renewal checkout becomes available after this period.
      </div>
    ` : ''}
    <div class="account-currency-row">
      <label>Payment currency
        <select id="account-payment-currency" ${availableCurrencies.length <= 1 ? 'disabled' : ''}>
          ${(availableCurrencies.length ? availableCurrencies : ['NGN']).map((currency) => `
            <option value="${currency}" ${currency === selectedCurrency ? 'selected' : ''}>${currency}</option>
          `).join('')}
        </select>
      </label>
      <p>We use your browser location as a suggestion, then only allow currencies supported by the selected provider and configured for this plan. NGN remains the fallback.</p>
    </div>
    <label class="account-check billing-ack">
      <input type="checkbox" id="account-billing-ack">
      <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and acknowledge the <a href="/refund" target="_blank" rel="noopener noreferrer">Refund Policy</a> before payment.</span>
    </label>
    <div class="account-plan-grid">
      ${visiblePlans.map((plan) => `
        <article class="account-plan-card ${plan.code === 'yearly' ? 'featured' : ''}">
          <span class="plan-kicker">${plan.code === 'activation_5m' ? 'Required once' : plan.recurring ? 'Renewal' : 'Plan'}</span>
          <h3>${escapeHtml(plan.name)}</h3>
          <div class="price">${formatCurrency(plan.prices?.[selectedCurrency] || plan.price_ngn, selectedCurrency)}</div>
          <p>${planDescription(plan)}</p>
          <div class="account-provider-actions">
            <button class="button button-small" type="button" data-checkout-provider="paystack" data-plan="${plan.code}" data-currencies="${(plan.provider_availability?.currencies?.paystack || []).join(',')}" data-enabled="${Boolean(plan.provider_availability?.paystack && !activationPeriodActive)}" disabled>
              Paystack
            </button>
            <button class="button button-small button-secondary" type="button" data-checkout-provider="flutterwave" data-plan="${plan.code}" data-currencies="${(plan.provider_availability?.currencies?.flutterwave || []).join(',')}" data-enabled="${Boolean(plan.provider_availability?.flutterwave && !activationPeriodActive)}" disabled>
              Flutterwave
            </button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderPortal({ overview, plans, providers, transactions }, flash = '') {
  const { user, store } = overview;
  const subscription = overview.subscription;
  const unlocked = downloadsUnlocked(subscription);

  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell account-portal-hero">
        <div class="page-intro">
          <span class="eyebrow">Account portal</span>
          <h1>Manage setup, billing, and downloads.</h1>
          <p>This is the website side of QuickPOS. It does not open the POS app or show app screens.</p>
          <div class="trust-row">
            <span>Admin-only portal</span>
            <span>Separate website session</span>
            <span>Downloads after activation</span>
          </div>
        </div>
        <aside class="account-status-card">
          <span class="account-badge ${unlocked ? 'success' : 'warning'}">${escapeHtml(subscription?.status || 'checking')}</span>
          <h2>${unlocked ? 'Downloads unlocked' : 'Activation required'}</h2>
          <p>${statusCopy(subscription)}</p>
          <button class="button button-secondary" type="button" id="account-logout">Sign out</button>
        </aside>
      </div>
    </section>

    <section class="section account-section">
      <div class="site-shell account-portal-grid">
        <aside class="account-sidebar">
          <strong>${escapeHtml(store?.name || 'QuickPOS Store')}</strong>
          <span>${escapeHtml(user.email)}</span>
          <a href="#profile">Account profile</a>
          <a href="#store">Store settings</a>
          <a href="#billing">Billing</a>
          <a href="#downloads">Downloads</a>
        </aside>

        <div class="account-main">
          <div data-account-alert>${flash ? `<div class="account-alert success">${escapeHtml(flash)}</div>` : ''}</div>

          <section class="account-panel" id="profile">
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Owner profile</span>
                <h2>Account settings</h2>
              </div>
              <span class="account-badge">Admin only</span>
            </div>
            <form class="account-form account-form-grid" id="account-profile-form">
              <label>Full name<input name="name" value="${escapeHtml(user.name || '')}" required></label>
              <label>Email<input name="email" type="email" value="${escapeHtml(user.email || '')}" required></label>
              <label>Phone<input name="phone" value="${escapeHtml(user.phone || '')}" placeholder="+234..."></label>
              <label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current password"></label>
              <button class="button" type="submit">Save account</button>
            </form>
          </section>

          <section class="account-panel" id="store">
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Store setup</span>
                <h2>Store settings</h2>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${unlocked ? 'Active' : 'Editable before payment'}</span>
            </div>
            <form class="account-form account-form-grid" id="account-store-form">
              <label>Store name<input name="name" value="${escapeHtml(store?.name || '')}" required minlength="2"></label>
              <label>Store email<input name="email" type="email" value="${escapeHtml(store?.email || '')}"></label>
              <label>Phone<input name="phone" value="${escapeHtml(store?.phone || '')}"></label>
              <label>Currency<input name="currency" value="${escapeHtml(store?.currency || 'NGN')}" maxlength="10"></label>
              <label class="span-2">Address<input name="address" value="${escapeHtml(store?.address || '')}"></label>
              <label>Tax rate (%)<input name="tax_rate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(store?.tax_rate ?? '')}"></label>
              <label class="span-2">Receipt header<textarea name="receipt_header" rows="3">${escapeHtml(store?.receipt_header || '')}</textarea></label>
              <label class="span-2">Receipt footer<textarea name="receipt_footer" rows="3">${escapeHtml(store?.receipt_footer || '')}</textarea></label>
              <button class="button" type="submit">Save store settings</button>
            </form>
          </section>

          <section class="account-panel" id="billing">
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Billing</span>
                <h2>${subscription?.activation_required ? 'Activate your store' : 'Manage subscription'}</h2>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${unlocked ? 'Paid access' : 'Pending payment'}</span>
            </div>
            <p class="account-muted">${statusCopy(subscription)}</p>
            ${renderPlanCards(plans, providers, subscription)}
            <div class="account-subpanel">
              <h3>Payment history</h3>
              ${renderTransactions(transactions)}
            </div>
          </section>

          <section class="account-panel" id="downloads">
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Downloads</span>
                <h2>${unlocked ? 'Choose your device' : 'Downloads unlock after activation'}</h2>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${unlocked ? 'Unlocked' : 'Locked'}</span>
            </div>
            ${unlocked ? `
              <div class="download-experience account-download-experience" data-account-download-grid>
                <div class="download-loading"><span class="download-spinner"></span>Loading your verified downloads...</div>
              </div>
            ` : `
              <div class="account-locked-downloads">
                <strong>Pay activation first.</strong>
                <p>Once payment is confirmed, this section will show Windows, Android, macOS, Linux, and iPhone options. The installed app uses the same login, but the website never opens the POS interface.</p>
                <a class="button" href="#billing">Go to billing</a>
              </div>
            `}
          </section>
        </div>
      </div>
    </section>
  `;

  attachPortalHandlers();
  if (unlocked) loadDownloads();
  const { mode } = routeInfo();
  if (['profile', 'store', 'billing', 'downloads'].includes(mode)) {
    setTimeout(() => document.getElementById(mode)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
}

function payloadFromForm(form, omitBlankKeys = []) {
  const formData = new FormData(form);
  const payload = {};
  formData.forEach((value, key) => {
    const text = typeof value === 'string' ? value.trim() : value;
    if (text === '' && omitBlankKeys.includes(key)) return;
    payload[key] = text;
  });
  return payload;
}

function attachPortalHandlers() {
  document.getElementById('account-logout')?.addEventListener('click', async () => {
    const refreshToken = siteApi.refreshToken;
    try {
      if (refreshToken) await siteApi.post('/auth/logout', { refreshToken });
    } catch {
      // Local sign-out should still complete.
    }
    siteApi.clearSession();
    window.location.hash = '#signin';
    renderSignIn();
  });

  document.getElementById('account-profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const payload = payloadFromForm(event.target, ['password']);
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const result = await siteApi.patch('/account/profile', payload);
      siteApi.updateUser(result.user);
      await loadPortal('Account profile updated.');
    } catch (error) {
      setFlash(error.message || 'Could not update profile', 'error');
      button.disabled = false;
      button.textContent = 'Save account';
    }
  });

  document.getElementById('account-store-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const payload = payloadFromForm(event.target, ['tax_rate']);
    if (payload.tax_rate !== undefined) payload.tax_rate = Number(payload.tax_rate);
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      await siteApi.patch('/account/store', payload);
      await loadPortal('Store settings updated.');
    } catch (error) {
      setFlash(error.message || 'Could not update store settings', 'error');
      button.disabled = false;
      button.textContent = 'Save store settings';
    }
  });

  const acknowledgement = document.getElementById('account-billing-ack');
  const currencySelect = document.getElementById('account-payment-currency');
  const checkoutButtons = [...document.querySelectorAll('[data-checkout-provider]')];
  const syncCheckoutButtons = () => {
    const selectedCurrency = currencySelect?.value || 'NGN';
    checkoutButtons.forEach((button) => {
      const providerCurrencies = (button.dataset.currencies || '').split(',').filter(Boolean);
      const currencyAvailable = providerCurrencies.includes(selectedCurrency);
      const enabled = button.dataset.enabled === 'true' && currencyAvailable;
      button.disabled = !enabled || !acknowledgement?.checked;
      button.title = enabled
        ? acknowledgement?.checked ? '' : 'Acknowledge the payment terms before checkout'
        : `${button.dataset.checkoutProvider === 'paystack' ? 'Paystack' : 'Flutterwave'} is not available for ${selectedCurrency} on this plan`;
    });
  };
  currencySelect?.addEventListener('change', () => {
    localStorage.setItem(PAYMENT_CURRENCY_KEY, currencySelect.value);
    loadPortal();
  });
  acknowledgement?.addEventListener('change', syncCheckoutButtons);
  syncCheckoutButtons();

  checkoutButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Opening...';
      try {
        const checkout = await siteApi.post('/billing/checkout', {
          provider: button.dataset.checkoutProvider,
          plan_code: button.dataset.plan,
          currency: currencySelect?.value || 'NGN',
          locale: navigator.language || '',
          legal_acknowledged: true,
        });
        window.open(checkout.authorization_url, '_blank', 'noopener,noreferrer');
        setFlash(
          checkout.currency_notice ||
            `Complete ${formatCurrency(checkout.amount, checkout.currency)} payment in the secure provider page. This portal will unlock downloads after confirmation.`,
          'info'
        );
        pollForActivation(button.dataset.plan);
      } catch (error) {
        setFlash(error.message || 'Could not start checkout', 'error');
      } finally {
        button.textContent = originalText;
        syncCheckoutButtons();
      }
    });
  });
}

function pollForActivation(planCode) {
  if (activationPoll) clearInterval(activationPoll);
  let attempts = 0;
  activationPoll = setInterval(async () => {
    attempts += 1;
    if (attempts > 30) {
      clearInterval(activationPoll);
      return;
    }
    try {
      const result = await siteApi.get('/billing/status');
      if (result.subscription?.plan_code === planCode && result.subscription?.can_write) {
        clearInterval(activationPoll);
        await loadPortal('Payment confirmed. Downloads are now unlocked.');
      }
    } catch {
      // Keep polling while the provider redirects and verifies payment.
    }
  }, 4000);
}

async function loadDownloads() {
  const target = document.querySelector('[data-account-download-grid]');
  if (!target) return;
  try {
    const manifest = await siteApi.get('/downloads/manifest');
    renderReleaseDownloads(target, manifest, {
      onDownloadClick: (data) => track('account_download_clicked', data),
    });
  } catch (error) {
    target.innerHTML = `
      <div class="release-error">
        <span class="platform-icon"></span>
        <div><h3>Downloads are not available yet</h3><p>${escapeHtml(error.message || 'Please try again shortly or contact support.')}</p></div>
        <a class="button button-secondary" href="/support">Contact support</a>
      </div>
    `;
  }
}

async function loadPortal(flash = '') {
  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell">
        <div class="download-loading"><span class="download-spinner"></span>Loading your QuickPOS account...</div>
      </div>
    </section>
  `;

  try {
    const overview = await siteApi.get('/account/overview');
    if (overview.user?.role !== 'admin') {
      siteApi.clearSession();
      renderAdminOnly();
      return;
    }

    const [plansResult, statusResult, transactionsResult] = await Promise.all([
      siteApi.get('/billing/plans'),
      siteApi.get('/billing/status'),
      siteApi.get('/billing/transactions'),
    ]);

    renderPortal({
      overview: {
        ...overview,
        subscription: statusResult.subscription || overview.subscription,
      },
      plans: plansResult.plans || [],
      providers: plansResult.providers || {},
      transactions: transactionsResult.transactions || [],
    }, flash);
  } catch (error) {
    siteApi.clearSession();
    renderSignIn();
    setFlash(error.message || 'Session expired. Please sign in again.', 'error');
  }
}

function bootstrap() {
  if (!root) return;
  const { mode, params } = routeInfo();

  if (mode === 'reset-password' || params.get('token')) {
    renderResetPassword();
    return;
  }
  if (mode === 'forgot-password') {
    renderForgotPassword();
    return;
  }
  if (mode === 'create' || mode === 'register' || mode === 'signup') {
    renderRegister();
    return;
  }
  if (!siteApi.accessToken || mode === 'signin' || mode === 'login') {
    renderSignIn();
    return;
  }
  loadPortal();
}

window.addEventListener('hashchange', bootstrap);
bootstrap();
