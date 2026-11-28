import { track } from '@vercel/analytics';
import { renderReleaseDownloads } from './downloads.js';
import {
  clearStoredSiteSession,
  readSiteSession,
  storeSiteSession,
  updateStoredSiteUser,
} from './session.js';
import { resolveApiBase } from '../../shared/src/api.js';
import { canIssueStaffCard } from '../../shared/src/staff-card-access.js';
import { staffPhotoField, bindStaffPhotoField, readStaffPhoto } from './staff-photo-field.js';
import './staff-photo-field.css';

const root = document.querySelector('[data-account-root]');
let paidThrough = Infinity;
let checkingPayment = false;

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, {
  development: import.meta.env.DEV,
});

class SiteApi {
  constructor() {
    const session = readSiteSession();
    this.accessToken = session.accessToken;
  }

  setSession(data) {
    this.accessToken = data.accessToken;
    storeSiteSession(data);
  }

  updateUser(user) {
    updateStoredSiteUser(user);
  }

  clearSession() {
    this.accessToken = null;
    clearStoredSiteSession();
  }

  async refreshAccessToken() {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-QuickPOS-Client': 'website',
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) return false;
      const data = await response.json();
      this.accessToken = data.accessToken;
      const session = readSiteSession();
      storeSiteSession({
        accessToken: data.accessToken,
        user: session.user,
      });
      return true;
    } catch {
      return false;
    }
  }

  async request(method, path, data = null) {
    const config = {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-QuickPOS-Client': 'website',
      },
    };
    if (this.accessToken) {
      config.headers.Authorization = `Bearer ${this.accessToken}`;
    }
    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }

    let response = await fetch(`${API_BASE}${path}`, config);
    if (response.status === 401 && this.accessToken) {
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
      // Keep the empty fallback for responses without a JSON body.
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
  delete(path) { return this.request('DELETE', path); }
}

const siteApi = new SiteApi();
const DEFAULT_PAYMENT_CURRENCY = 'NGN';
const INTERNATIONAL_PAYMENT_CURRENCY = 'USD';
const PORTAL_SECTIONS = ['overview', 'profile', 'store', 'staff', 'billing', 'downloads'];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function currencyFromCountry(country = '') {
  const code = String(country || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return INTERNATIONAL_PAYMENT_CURRENCY;
  return code === 'NG' ? DEFAULT_PAYMENT_CURRENCY : INTERNATIONAL_PAYMENT_CURRENCY;
}

function currencyFromLocale(locale = '') {
  const country = countryFromLocale(locale);
  return country ? currencyFromCountry(country) : INTERNATIONAL_PAYMENT_CURRENCY;
}

function currencyFromTimeZone(timeZone = '') {
  const normalized = String(timeZone || '').trim();
  if (!normalized) return null;
  return normalized === 'Africa/Lagos'
    ? DEFAULT_PAYMENT_CURRENCY
    : INTERNATIONAL_PAYMENT_CURRENCY;
}

function detectLocalCurrency() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localeHints = [
    ...(navigator.languages || []),
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];

  return [
    currencyFromTimeZone(timeZone),
    ...localeHints.map((locale) => currencyFromLocale(locale)),
    INTERNATIONAL_PAYMENT_CURRENCY,
    DEFAULT_PAYMENT_CURRENCY,
  ].find(Boolean);
}

function detectPreferredCurrency(serverCurrency = '') {
  const normalized = String(serverCurrency || '').trim().toUpperCase();
  return ['NGN', 'USD'].includes(normalized) ? normalized : detectLocalCurrency();
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

function formatPaymentTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function paymentPlanName(code = '') {
  const names = {
    activation_5m: 'Initial activation · 5 months',
    monthly: 'Monthly subscription',
    quarterly: 'Quarterly subscription',
    yearly: 'Yearly subscription',
  };
  return names[code] || String(code || 'QuickPOS subscription')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentProviderName(provider = '') {
  const names = { paystack: 'Paystack', flutterwave: 'Flutterwave' };
  return names[String(provider).toLowerCase()] || 'Secure payment';
}

function renderStaffDirectory(staff, user, { paidTools = false, readOnly = false } = {}) {
  if (!staff.length) {
    return `
      <div class="staff-empty-state">
        <strong>No staff accounts yet</strong>
        <p>${readOnly ? 'Add a cashier in the installed QuickPOS app first.' : 'Create the first account using the form beside this directory.'}</p>
      </div>
    `;
  }

  return `
    <div class="staff-list">
      ${staff.map((member) => {
        const role = String(member.role || 'cashier').toLowerCase();
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        const isCurrentUser = String(member.id) === String(user.id);
        const isActive = member.is_active !== false;
        const encodedMember = encodeURIComponent(JSON.stringify({
          id: member.id,
          name: member.name || '',
          email: member.email || '',
          phone: member.phone || '',
          role,
          is_active: isActive,
          is_current_user: isCurrentUser,
        }));

        return `
          <article class="staff-member">
            <div class="staff-avatar staff-avatar-${escapeHtml(role)}" aria-hidden="true">${escapeHtml(roleLabel.charAt(0))}</div>
            <div class="staff-member-copy">
              <div class="staff-member-heading">
                <strong>${escapeHtml(member.name || member.email)}</strong>
                ${isCurrentUser ? '<span class="staff-you-label">You</span>' : ''}
              </div>
              <span>${escapeHtml(member.email)}</span>
              <div class="staff-member-meta">
                <span class="staff-role-badge staff-role-${escapeHtml(role)}">${escapeHtml(roleLabel)}</span>
                <span class="staff-status ${isActive ? 'is-active' : 'is-inactive'}">
                  <span aria-hidden="true"></span>
                  ${isActive ? 'Active' : 'Inactive'}
                </span>
                <span>Added ${escapeHtml(formatDate(member.created_at))}</span>
              </div>
            </div>
            <div class="staff-member-actions" aria-label="Staff actions">
              ${paidTools && canIssueStaffCard(user.role, role) ? `<button class="staff-action-button" type="button" data-account-staff-card="${escapeHtml(member.id)}" aria-label="ID card for ${escapeHtml(member.name || member.email)}">ID card</button>` : ''}
              ${readOnly ? '' : `<button class="staff-action-button" type="button" data-account-staff-edit="${encodedMember}">Edit</button>`}
              ${readOnly || isCurrentUser ? '' : `
                <button class="staff-action-button danger" type="button" data-account-staff-archive="${escapeHtml(member.id)}">Delete</button>
              `}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function showAccountStaffEditModal(member) {
  const overlay = document.createElement('div');
  overlay.className = 'account-modal-overlay';
  overlay.innerHTML = `
    <div class="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-staff-edit-title">
      <div class="account-modal-heading">
        <div>
          <span class="section-kicker">Staff access</span>
          <h3 id="account-staff-edit-title">Edit staff account</h3>
        </div>
        <button class="account-modal-close" type="button" aria-label="Close staff editor">x</button>
      </div>
      <form id="account-staff-edit-form" class="account-form">
        <div class="account-form-grid">
          <label>
            Full name
            <input name="name" value="${escapeHtml(member.name || '')}" required>
          </label>
          <label>
            Email address
            <input name="email" type="email" value="${escapeHtml(member.email || '')}" required>
          </label>
          <label>
            Phone number
            <input name="phone" type="tel" value="${escapeHtml(member.phone || '')}" placeholder="Optional">
          </label>
          ${member.is_current_user ? '' : `
            <label>
              Role
              <select name="role" required>
                <option value="cashier" ${member.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                <option value="manager" ${member.role === 'manager' ? 'selected' : ''}>Manager</option>
                <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
            </label>
            <label>
              Account status
              <select name="is_active" required>
                <option value="true" ${member.is_active ? 'selected' : ''}>Active</option>
                <option value="false" ${member.is_active ? '' : 'selected'}>Inactive</option>
              </select>
            </label>
          `}
          <label class="${member.is_current_user ? '' : 'span-2'}">
            New password
            <input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current password">
          </label>
        </div>
        ${staffPhotoField('edit-staff-portrait', true)}
        <p class="account-muted" role="status" data-staff-edit-status></p>
        <div class="staff-form-note">
          <strong>${member.is_current_user ? 'Use profile settings for your own admin access.' : 'Role and status changes apply to the installed app.'}</strong>
          <span>${member.is_current_user ? 'Your role and active status are protected here so the store does not lock itself out.' : 'Deleted or inactive staff cannot continue using QuickPOS.'}</span>
        </div>
        <div class="account-modal-actions">
          <button class="button button-secondary" type="button" data-account-modal-cancel>Cancel</button>
          <button class="button" type="submit">Save staff account</button>
        </div>
      </form>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('[data-account-modal-cancel]')?.addEventListener('click', close);
  overlay.querySelector('.account-modal-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('#account-staff-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const payload = payloadFromForm(form, ['phone', 'password']);
    const status = form.querySelector('[data-staff-edit-status]');
    if (payload.is_active !== undefined) payload.is_active = payload.is_active === 'true';
    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      payload.staff_photo = await readStaffPhoto(form);
      await siteApi.patch(`/account/staff/${member.id}`, payload);
      close();
      await loadPortal('Staff account updated.');
    } catch (error) {
      status.textContent = error.message || 'Could not update staff account';
      button.disabled = false;
      button.textContent = 'Save staff account';
    }
  });

  document.body.appendChild(overlay);
  bindStaffPhotoField(overlay.querySelector('form'));
  overlay.querySelector('input[name="name"]')?.focus();
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
    ? `<div class="account-alert ${type}" role="${type === 'error' ? 'alert' : 'status'}" aria-live="${type === 'error' ? 'assertive' : 'polite'}">${escapeHtml(message)}</div>`
    : '';
}

function renderAuthShell({ eyebrow, title, copy, intro, form, footer }) {
  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell account-auth-grid">
        <div class="page-intro">
          <span class="eyebrow">${eyebrow}</span>
          <h1 tabindex="-1">${title}</h1>
          <p>${copy}</p>
          ${intro ?? `<div class="trust-row">
            <span>One QuickPOS account</span>
            <span>Same login in the POS app</span>
            <span>Admin billing portal</span>
          </div>`}
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

function renderSignIn({ createdEmail = '', message = '' } = {}) {
  renderAuthShell({
    eyebrow: 'Owner portal',
    title: 'Sign in to manage your store account.',
    copy: 'Use the same email address and password on this website and in the QuickPOS app. Both connect to the same store account, subscription, and database.',
    form: `
      <form class="account-form" id="site-login-form">
        <label>Email address<input name="email" type="email" inputmode="email" autocomplete="username" spellcheck="false" required value="${escapeHtml(createdEmail)}" placeholder="owner@yourstore.com"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required placeholder="Your password…"></label>
        <button class="button" type="submit" id="site-login-submit">Sign in</button>
      </form>
    `,
    footer: `
      <a href="#create">Create store account</a>
      <span>·</span>
      <a href="#forgot-password">Forgot password?</a>
    `,
  });
  if (message) setFlash(message);

  document.getElementById('site-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('site-login-submit');
    const form = new FormData(event.target);
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const data = await siteApi.post('/auth/login', {
        email: normalizeEmail(form.get('email')),
        password: form.get('password'),
      });
      if (!['admin', 'manager'].includes(data.user?.role)) {
        try {
          await siteApi.post('/auth/logout', {});
        } catch {
          // The website session is still cleared locally below.
        }
        siteApi.clearSession();
        renderAdminOnly();
        return;
      }
      siteApi.setSession(data);
      if (data.user.role === 'manager') {
        await loadPortal('', { focus: true });
        return;
      }
      const { mode, params } = routeInfo();
      if (returnedPayment(params)) {
        await bootstrap();
        return;
      }
      const section = PORTAL_SECTIONS.includes(mode)
        ? mode
        : data.subscription?.activation_required ? 'billing' : 'overview';
      window.history.replaceState({}, '', `#${section}`);
      await loadPortal('', { focus: true });
    } catch (error) {
      setFlash(error.message || 'Could not sign in', 'error');
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function activationSteps({ registered = false, billing = false } = {}) {
  return `
    <ol class="activation-steps" aria-label="Store setup checklist" role="list">
      <li${registered ? ' data-complete' : ' aria-current="step"'}>
        <span aria-hidden="true">${registered ? '✓' : '1'}</span>
        <div><strong>${registered ? 'Store account created' : 'Create your store account'}</strong>
        <p>${registered ? 'You can use this login in the app.' : 'No payment is collected at signup.'}</p></div>
      </li>
      <li${billing ? ' aria-current="step"' : ''}>
        <span aria-hidden="true">2</span>
        <div><strong>Activate your store</strong><p>One payment covers your first five months.</p></div>
      </li>
      <li>
        <span aria-hidden="true">3</span>
        <div><strong>Download QuickPOS</strong><p>Install the app after payment is confirmed.</p></div>
      </li>
    </ol>
  `;
}

function renderRegister() {
  renderAuthShell({
    eyebrow: 'Create account',
    title: 'Create your QuickPOS store account.',
    copy: 'Start with your store and owner details. You can review the activation price before deciding to pay.',
    intro: `${activationSteps()}<a class="activation-text-link" href="/pricing">View pricing</a>`,
    form: `
      <form class="account-form" id="site-register-form">
        <label>Store name<input name="store_name" type="text" autocomplete="organization" minlength="2" maxlength="255" required placeholder="Your store name"></label>
        <label>Owner name<input name="name" type="text" autocomplete="name" required placeholder="Full name"></label>
        <label>Email address<input name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required placeholder="owner@yourstore.com"></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters…"></label>
        <details class="account-optional-field">
          <summary>Add a phone number (optional)</summary>
          <label>Phone number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+234…"></label>
        </details>
        <label class="account-check">
          <input type="checkbox" name="consent" required>
          <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and acknowledge the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span>
        </label>
        <button class="button" type="submit" id="site-register-submit">Create store account</button>
        <p class="activation-note">Next: review your activation price and payment options.</p>
      </form>
    `,
    footer: 'Already have an account? <a href="#signin">Sign in</a>',
  });

  document.getElementById('site-register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('site-register-submit');
    const form = new FormData(event.target);
    const email = normalizeEmail(form.get('email'));
    const password = form.get('password');
    button.disabled = true;
    button.textContent = 'Creating…';

    try {
      const storeName = String(form.get('store_name') || '').trim();
      const ownerName = String(form.get('name') || '').trim();
      if (storeName.length < 2 || !ownerName) {
        const field = event.target.elements.namedItem(storeName.length < 2 ? 'store_name' : 'name');
        field.setCustomValidity(storeName.length < 2 ? 'Enter at least two characters for your store name.' : 'Enter the store owner’s name.');
        field.reportValidity();
        return;
      }
      await siteApi.post('/auth/register', {
        store_name: storeName,
        name: ownerName,
        email,
        phone: form.get('phone') || undefined,
        password,
        terms_accepted: form.has('consent'),
        privacy_acknowledged: form.has('consent'),
      });
    } catch (error) {
      setFlash(error.message || 'Could not create account', 'error');
      return;
    } finally {
      button.disabled = false;
      button.textContent = 'Create store account';
    }

    button.disabled = true;
    button.textContent = 'Opening your store…';
    try {
      const data = await siteApi.post('/auth/login', { email, password });
      siteApi.setSession(data);
    } catch {
      window.history.replaceState({}, '', '#billing');
      renderSignIn({ createdEmail: email, message: 'Your store account was created. Sign in to review your activation options.' });
      root.querySelector('h1')?.focus();
      return;
    }
    window.history.replaceState({}, '', '#billing');
    await loadPortal('', { focus: true });
  });

  root.querySelectorAll('#site-register-form [name="store_name"], #site-register-form [name="name"]').forEach((field) => {
    field.addEventListener('input', () => field.setCustomValidity(''));
  });
}

function renderForgotPassword() {
  renderAuthShell({
    eyebrow: 'Password reset',
    title: 'Get a secure reset link.',
    copy: 'Enter the email used for your QuickPOS account. If it exists, we will send a reset link.',
    form: `
      <form class="account-form" id="site-forgot-form">
        <label>Email address<input name="email" type="email" inputmode="email" autocomplete="username" spellcheck="false" required placeholder="owner@yourstore.com"></label>
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
    button.textContent = 'Sending…';
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
        <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters…"></label>
        <label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required placeholder="Repeat password…"></label>
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
    const confirmationField = event.target.elements.confirm_password;
    const button = document.getElementById('site-reset-submit');
    confirmationField.setCustomValidity('');
    if (password !== confirmation) {
      confirmationField.setCustomValidity('Passwords do not match. Enter the same password in both fields.');
      confirmationField.reportValidity();
      return;
    }
    button.disabled = true;
    button.textContent = 'Resetting…';
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

  document.querySelector('#site-reset-form [name="confirm_password"]')?.addEventListener('input', (event) => {
    event.target.setCustomValidity('');
  });
}

function renderAdminOnly() {
  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell account-auth-grid">
        <div class="page-intro">
          <span class="eyebrow">Staff access</span>
          <h1>Cashiers sign in from the QuickPOS app.</h1>
          <p>Store owners and managers can sign in to the website for their assigned tasks.</p>
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

function subscriptionStatusLabel(subscription) {
  if (!subscription) return 'Checking access';
  const labels = {
    grandfathered: 'Full access',
    pending_activation: 'Activation required',
    trialing: 'Trial access',
    active: subscription.cancel_at_period_end ? 'Active · renewal off' : 'Active',
    past_due: 'Payment required',
    cancelled: 'Renewal cancelled',
    expired: 'Access expired',
  };
  return labels[subscription.status] || 'Access review';
}

function statusCopy(subscription) {
  if (!subscription) return 'We are confirming your account access.';
  if (subscription.status === 'grandfathered') return 'Your store has full access with no renewal payment required.';
  if (subscription.status === 'trialing') {
    return subscription.trial_ends_at
      ? `Your trial includes full access through ${formatDate(subscription.trial_ends_at)}.`
      : 'Your store currently has full trial access.';
  }
  if (subscription.activation_required) return 'Complete the one-time activation to unlock downloads and full app access.';
  if (subscription.cancel_at_period_end || subscription.status === 'cancelled') {
    return subscription.current_period_end
      ? `Your access continues through ${formatDate(subscription.current_period_end)}; automatic renewal is off.`
      : 'Automatic renewal is off and no further charge is scheduled.';
  }
  if (subscription.status === 'active') return `Your paid access is active through ${formatDate(subscription.current_period_end)}.`;
  if (subscription.status === 'past_due') return 'Your latest renewal payment was not confirmed. Update billing to keep access active.';
  if (subscription.status === 'expired') return 'Your paid access has ended. Renew to restore downloads and full app access.';
  return 'We are reviewing your subscription access. Refresh shortly or contact support if this continues.';
}

function billingNextAction(subscription) {
  if (!subscription) return 'Wait for the account check to finish';
  if (subscription.status === 'grandfathered') return 'No payment action required';
  if (subscription.activation_required) return 'Complete the one-time activation';
  if (['past_due', 'expired'].includes(subscription.status)) return 'Choose a plan and renew access';
  if (subscription.cancel_at_period_end || subscription.status === 'cancelled') return 'Choose a plan when you want to renew';
  if (subscription.status === 'trialing') return 'Activate before the trial ends';
  return 'Review renewal options when you are ready';
}

function planCadence(plan) {
  if (plan.code === 'activation_5m') return 'one-time payment';
  if (plan.code === 'monthly') return 'per month';
  if (plan.code === 'quarterly') return 'every 3 months';
  if (plan.code === 'yearly') return 'per year';
  return plan.recurring ? 'recurring' : 'one-time payment';
}

function downloadsUnlocked(subscription) {
  return Boolean(subscription?.can_write && !subscription?.activation_required);
}

function portalSectionFromRoute() {
  const { mode } = routeInfo();
  return PORTAL_SECTIONS.includes(mode) ? mode : 'overview';
}

function activatePortalSection(section, { focus = false } = {}) {
  const activeSection = PORTAL_SECTIONS.includes(section) ? section : 'overview';

  document.querySelectorAll('[data-account-panel]').forEach((panel) => {
    const active = panel.dataset.accountPanel === activeSection;
    panel.hidden = !active;
    panel.inert = !active;
    panel.setAttribute('aria-hidden', String(!active));
  });

  document.querySelectorAll('[data-account-section-link]').forEach((link) => {
    const active = link.dataset.accountSectionLink === activeSection;
    link.classList.toggle('active', active);
    link.setAttribute('aria-selected', String(active));
  });

  const activePanel = document.querySelector(`[data-account-panel="${activeSection}"]`);
  if (focus && activePanel) {
    activePanel.querySelector('h2')?.focus();
  }

  if (activeSection === 'downloads') loadDownloads();
}

function openPortalSection(section, { updateHistory = true, focus = true } = {}) {
  const activeSection = PORTAL_SECTIONS.includes(section) ? section : 'overview';
  if (updateHistory && routeInfo().mode !== activeSection) {
    history.pushState(null, '', `#${activeSection}`);
  }
  activatePortalSection(activeSection, { focus });
}

function renderTransactions(transactions = []) {
  const confirmed = transactions.filter((transaction) => transaction.status === 'success');
  if (!confirmed.length) {
    return `
      <div class="payment-empty-state">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>No confirmed payments yet</strong>
          <p>Completed payments will appear here after they are verified by Paystack or Flutterwave.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="account-table-wrap">
      <table class="account-table payment-history-table">
        <thead><tr><th>Payment date</th><th>Description</th><th>Payment method</th><th>Receipt reference</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          ${confirmed.map((transaction) => {
            const paidAt = transaction.paid_at || transaction.created_at;
            return `
            <tr>
              <td data-label="Payment date"><div class="payment-cell-stack"><strong>${escapeHtml(formatDate(paidAt))}</strong><span>${escapeHtml(formatPaymentTime(paidAt))}</span></div></td>
              <td data-label="Description"><div class="payment-cell-stack"><strong>${escapeHtml(paymentPlanName(transaction.plan_code))}</strong><span>QuickPOS account access</span></div></td>
              <td data-label="Payment method"><div class="payment-provider"><span>${escapeHtml(paymentProviderName(transaction.provider).charAt(0))}</span><strong>${escapeHtml(paymentProviderName(transaction.provider))}</strong></div></td>
              <td data-label="Receipt reference"><code>${escapeHtml(transaction.provider_reference || transaction.provider_transaction_id || 'Unavailable')}</code></td>
              <td data-label="Amount"><strong class="payment-amount">${formatCurrency(transaction.amount_ngn, transaction.currency || 'NGN')}</strong></td>
              <td data-label="Status"><span class="payment-status-paid"><i aria-hidden="true">✓</i> Paid</span></td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

const CHECKOUT_PROVIDERS = { paystack: 'Paystack', flutterwave: 'Flutterwave' };

function paymentChoices(plans, activation, currency) {
  return plans
    .filter((plan) => (plan.code === 'activation_5m') === activation)
    .map((plan) => {
      const amount = Number(plan.prices?.[currency]);
      const priced = Number.isFinite(amount) && amount > 0;
      return {
        ...plan,
        price: priced ? formatCurrency(amount, currency) : '',
        providers: priced ? Object.keys(CHECKOUT_PROVIDERS).filter((provider) =>
          plan.provider_availability?.[provider] &&
          plan.provider_availability?.currencies?.[provider]?.includes(currency)
        ) : [],
      };
    });
}

function renderBillingCheckout(plans, subscription, billingCurrency) {
  const activation = Boolean(subscription?.activation_required);
  const currency = detectPreferredCurrency(billingCurrency);
  const choices = paymentChoices(plans, activation, currency);
  const canCheckout = choices.some((plan) => plan.providers.length);
  const activationTermActive = subscription?.plan_code === 'activation_5m' && subscription.can_write && !activation;
  const activePaidTerm = subscription?.can_write && subscription.provider &&
    !activation && Date.parse(subscription.current_period_end) > Date.parse(subscription.server_time || new Date().toISOString());

  if (activationTermActive || activePaidTerm) {
    return `
      <div class="account-notice billing-alert">
        Access is active through ${formatDate(subscription.current_period_end)}.
        You can choose a new plan after this billing period ends.
      </div>
    `;
  }
  if (!subscription || subscription.status === 'grandfathered') return '';

  const single = choices.length === 1 ? choices[0] : null;
  const checkoutDetails = (plan) => `data-provider-options="${plan.providers.join(' ')}" data-total="${escapeHtml(plan.price)}" data-cadence="${escapeHtml(planCadence(plan))}" data-recurring="${Boolean(plan.recurring)}"`;
  return `
    <div class="billing-purchase-layout ${activation ? 'has-activation' : ''}">
      <section class="billing-purchase" aria-labelledby="billing-purchase-title">
        <h3 id="billing-purchase-title">${activation ? 'Activation checkout' : 'Renewal checkout'}</h3>
        ${!canCheckout ? `
          ${single?.price ? `<p class="billing-total"><strong>${escapeHtml(single.price)}</strong> <span>${currency} · ${planCadence(single)}</span></p>` : ''}
          <p>Online checkout isn’t available in ${currency} for your plan right now.</p>
          <a class="activation-text-link" href="/support">Contact QuickPOS support</a>
        ` : `
          <form class="billing-payment-form" id="account-checkout-form" data-currency="${currency}" data-form-experience="off" novalidate>
            ${single ? `
              <input type="hidden" name="plan_code" value="${escapeHtml(single.code)}" ${checkoutDetails(single)}>
            ` : `
              <div class="billing-field">
                <label for="account-checkout-plan">Billing plan</label>
                <select id="account-checkout-plan" name="plan_code" required aria-describedby="account-plan-error">
                  <option value="" selected disabled>Choose a billing plan</option>
                  ${choices.map((plan) => `
                    <option value="${escapeHtml(plan.code)}" ${checkoutDetails(plan)} ${plan.providers.length ? '' : 'disabled'}>
                      ${escapeHtml(plan.name)}${plan.price ? ` · ${escapeHtml(plan.price)} ${planCadence(plan)}` : ''}${plan.providers.length ? '' : ` (unavailable in ${currency})`}
                    </option>
                  `).join('')}
                </select>
                <p class="billing-field-error" id="account-plan-error" hidden></p>
              </div>
            `}
            <div class="billing-price-summary" aria-live="polite" aria-atomic="true">
              <p class="billing-total"><strong data-checkout-total>${single ? escapeHtml(single.price) : '—'}</strong> <span data-checkout-cadence>${currency}${single ? ` · ${planCadence(single)}` : ''}</span></p>
              <p class="activation-note" data-checkout-renewal>${activation ? 'Five months of full access. Does not auto-renew.' : 'Choose a plan to see the amount and renewal schedule.'}</p>
            </div>
            <fieldset class="billing-provider-fieldset" aria-describedby="account-provider-error">
              <legend>Payment provider</legend>
              <div class="billing-provider-choices">
                ${Object.entries(CHECKOUT_PROVIDERS).map(([provider, label]) => `
                  <label class="billing-provider-choice">
                    <input type="radio" name="provider" value="${provider}" ${single?.providers.includes(provider) ? '' : 'disabled'} ${single?.providers.length === 1 && single.providers[0] === provider ? 'checked' : ''}>
                    <span><strong>${label}</strong><small data-billing-provider-status></small></span>
                  </label>
                `).join('')}
              </div>
              <p class="billing-field-error" id="account-provider-error" hidden></p>
            </fieldset>
            <div class="billing-consent">
              <label class="account-check billing-ack">
                <input type="checkbox" id="account-billing-ack" name="legal_acknowledged" required aria-describedby="account-consent-error">
                <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/refund" target="_blank" rel="noopener noreferrer">Refund Policy</a>.</span>
              </label>
              <p class="billing-field-error" id="account-consent-error" hidden></p>
            </div>
            <p class="billing-field-error" data-checkout-error role="alert" tabindex="-1" hidden></p>
            <button class="button" type="submit">Continue to secure payment</button>
            <p class="activation-note">You’ll review and complete payment on your provider’s secure page.</p>
          </form>
        `}
      </section>
      ${activation ? `<section class="billing-setup" aria-label="Setup progress">
        <h3>Get ready to sell</h3>
        ${activationSteps({ registered: true, billing: true })}
      </section>` : ''}
    </div>
  `;
}

function needsInitialActivation(subscription) {
  return !subscription?.can_write;
}

function updateStoreAccess(subscription) {
  document.body.toggleAttribute('data-account-access-locked', needsInitialActivation(subscription));
  paidThrough = subscription?.can_write
    ? Date.now() + (Date.parse(subscription.entitlement_ends_at) - Date.parse(subscription.server_time))
    : Infinity;
}

function keepActivationRoute() {
  const { mode, params } = routeInfo();
  if (mode === 'billing') return;
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}#billing`);
}

function renderActivationGate(store, checkout, flash, renewal = false) {
  keepActivationRoute();
  root.innerHTML = `
    <section class="section account-section" data-account-gate aria-labelledby="activation-gate-title">
      <div class="site-shell account-gate-shell">
        <header class="account-gate-heading">
          <div class="page-intro">
            <span class="eyebrow">${renewal ? 'Billing' : 'Setup · Step 2 of 3'}</span>
            <h1 id="activation-gate-title" tabindex="-1">${renewal ? 'Renew your store access' : 'Activate your store'}</h1>
            <p>${renewal ? 'Your paid term has ended. Renew to reopen the staff area, downloads, and the POS app.' : `${escapeHtml(store?.name || 'Your store')} is registered. Complete the one-time payment to unlock the portal and start using QuickPOS.`}</p>
          </div>
          <button class="button button-secondary" type="button" id="account-logout">Sign out</button>
        </header>
        <div data-account-alert></div>
        ${checkout}
        <p class="account-gate-help">Need a hand? <a class="activation-text-link" href="/support">Contact QuickPOS support</a>.</p>
      </div>
    </section>
  `;
  if (flash) setFlash(typeof flash === 'string' ? flash : flash.message, typeof flash === 'string' ? 'success' : flash.type);
  attachSignOutHandler();
  attachBillingHandlers();
  document.getElementById('activation-gate-title')?.focus({ preventScroll: true });
}

function renderPortal({ overview, plans, transactions, staff = [], billingCurrency }, flash = '', { focus = false } = {}) {
  const { user, store } = overview;
  const subscription = overview.subscription;
  const unlocked = downloadsUnlocked(subscription);
  const activeSection = portalSectionFromRoute();
  const activation = Boolean(subscription?.activation_required);
  const pendingPayment = Boolean(returnedPayment(routeInfo().params));
  const checkout = pendingPayment ? `
    <div class="account-notice billing-alert">
      <p>Check this payment before starting another. If you see a charge and your store is still locked, contact support.</p>
      <button class="button" type="button" data-check-payment>Check payment status</button>
      <a class="activation-text-link" href="/support">Contact support</a>
    </div>
  ` : renderBillingCheckout(plans, subscription, billingCurrency);
  if (needsInitialActivation(subscription)) {
    renderActivationGate(store, checkout, flash, subscription?.activation_required === false);
    return;
  }
  const confirmedTransactions = transactions.filter((transaction) => transaction.status === 'success');

  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell account-portal-hero">
        <div class="page-intro">
          <span class="eyebrow">Account portal</span>
          <h1>Manage your QuickPOS account.</h1>
          <p>Update store details, control staff access, manage billing, and download verified applications.</p>
          <div class="trust-row">
            <span>Admin-only portal</span>
            <span>Separate website session</span>
            <span>Downloads after activation</span>
          </div>
        </div>
        <aside class="account-status-card">
          <span class="account-badge ${unlocked ? 'success' : 'warning'}">${escapeHtml(subscriptionStatusLabel(subscription))}</span>
          <h2>${unlocked ? 'Downloads unlocked' : activation ? 'Store setup incomplete' : 'Access limited'}</h2>
          <p>${escapeHtml(statusCopy(subscription))}</p>
          <button class="button button-secondary" type="button" id="account-logout">Sign out</button>
        </aside>
      </div>
    </section>

    <section class="section account-section">
      <div class="site-shell account-portal-grid" data-account-portal>
        <aside class="account-sidebar">
          <strong>${escapeHtml(store?.name || 'QuickPOS Store')}</strong>
          <span>${escapeHtml(user.email)}</span>
          <nav class="account-sidebar-nav" aria-label="Account portal" role="tablist">
            <button type="button" role="tab" data-account-section-link="overview">Overview</button>
            <button type="button" role="tab" data-account-section-link="profile">Account profile</button>
            <button type="button" role="tab" data-account-section-link="store">Store settings</button>
            <button type="button" role="tab" data-account-section-link="staff">Staff</button>
            <button type="button" role="tab" data-account-section-link="billing">Billing</button>
            <button type="button" role="tab" data-account-section-link="downloads">Downloads</button>
          </nav>
        </aside>

        <div class="account-main">
          <div data-account-alert></div>

          <section class="account-panel" data-account-panel="overview" ${activeSection === 'overview' ? '' : 'hidden'}>
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Store administration</span>
                <h2 tabindex="-1">Account overview</h2>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${unlocked ? 'Active' : 'Setup required'}</span>
            </div>
            ${activation ? `
              <div class="account-activation-prompt">
                <div><strong>Finish setting up your store</strong><p>Your account is ready. Activate to unlock sales, inventory, staff access, and app downloads.</p></div>
                <button class="button" type="button" data-account-open-section="billing">Continue to activation</button>
              </div>
            ` : '<p class="account-muted">Manage your store, team, billing, and downloads.</p>'}
            <div class="account-overview-grid">
              <button class="account-overview-card" type="button" data-account-open-section="profile">
                <span class="section-kicker">Owner</span>
                <h3>Account profile</h3>
                <p>${escapeHtml(user.name || 'Store owner')}<br>${escapeHtml(user.email || '')}</p>
                <strong>Open account settings</strong>
              </button>
              <button class="account-overview-card" type="button" data-account-open-section="store">
                <span class="section-kicker">Business</span>
                <h3>Store settings</h3>
                <p>${escapeHtml(store?.name || 'QuickPOS Store')}<br>${escapeHtml(store?.currency || 'NGN')} store currency</p>
                <strong>Open store settings</strong>
              </button>
              <button class="account-overview-card" type="button" data-account-open-section="staff">
                <span class="section-kicker">Team access</span>
                <h3>Staff accounts</h3>
                <p>${escapeHtml(String(staff.length))} account${staff.length === 1 ? '' : 's'} across admin, manager, and cashier roles.</p>
                <strong>Create or review staff</strong>
              </button>
              <button class="account-overview-card" type="button" data-account-open-section="billing">
                <span class="section-kicker">Subscription</span>
                <h3>Billing</h3>
                <p>${escapeHtml(statusCopy(subscription))}</p>
                <strong>${subscription?.activation_required ? 'Complete activation' : 'Manage billing'}</strong>
              </button>
              <button class="account-overview-card" type="button" data-account-open-section="downloads">
                <span class="section-kicker">QuickPOS apps</span>
                <h3>Downloads</h3>
                <p>${unlocked ? 'Your verified device downloads are available.' : 'Downloads unlock after your activation payment is confirmed.'}</p>
                <strong>${unlocked ? 'Choose a download' : 'View download status'}</strong>
              </button>
            </div>
          </section>

          <section class="account-panel" data-account-panel="profile" ${activeSection === 'profile' ? '' : 'hidden'}>
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Owner profile</span>
                <h2 tabindex="-1">Account settings</h2>
              </div>
              <span class="account-badge">Admin only</span>
            </div>
            <form class="account-form account-form-grid" id="account-profile-form">
              <label>Full name<input name="name" autocomplete="name" value="${escapeHtml(user.name || '')}" required></label>
              <label>Email<input name="email" type="email" value="${escapeHtml(user.email || '')}" required></label>
              <label>Phone<input name="phone" value="${escapeHtml(user.phone || '')}" placeholder="+234..."></label>
              <label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current password"></label>
              <button class="button" type="submit">Save account</button>
            </form>
          </section>

          <section class="account-panel" data-account-panel="store" ${activeSection === 'store' ? '' : 'hidden'}>
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Store setup</span>
                <h2 tabindex="-1">Store settings</h2>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${unlocked ? 'Active' : 'Editable before payment'}</span>
            </div>
            <form class="account-form account-form-grid" id="account-store-form">
              <label>Store name<input name="name" autocomplete="organization" value="${escapeHtml(store?.name || '')}" required minlength="2"></label>
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

          <section class="account-panel account-staff-panel" data-account-panel="staff" ${activeSection === 'staff' ? '' : 'hidden'}>
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Team access</span>
                <h2 tabindex="-1">Staff accounts</h2>
                <p>Create separate sign-ins so each team member has the access their role requires.</p>
              </div>
              <span class="account-badge">${escapeHtml(String(staff.length))} total</span>
            </div>

            <div class="staff-role-grid" aria-label="Staff role permissions">
              <article class="staff-role-card staff-role-card-admin">
                <span class="staff-role-icon" aria-hidden="true">A</span>
                <div>
                  <strong>Admin</strong>
                  <p>Manages billing and store settings and issues manager and admin cards.</p>
                </div>
              </article>
              <article class="staff-role-card staff-role-card-manager">
                <span class="staff-role-icon" aria-hidden="true">M</span>
                <div>
                  <strong>Manager</strong>
                  <p>Runs daily operations and issues cashier cards.</p>
                </div>
              </article>
              <article class="staff-role-card staff-role-card-cashier">
                <span class="staff-role-icon" aria-hidden="true">C</span>
                <div>
                  <strong>Cashier</strong>
                  <p>Focused access for processing sales and completing checkout tasks.</p>
                </div>
              </article>
            </div>

            <div class="staff-workspace">
              <article class="staff-create-card">
                <div class="staff-card-heading">
                  <div>
                    <span class="section-kicker">New account</span>
                    <h3>Create a staff member</h3>
                  </div>
                </div>
                ${unlocked ? `
                  <form id="account-staff-form" class="account-form staff-form">
                    <div class="account-form-grid">
                      <label>
                        Full name
                        <input name="name" type="text" autocomplete="name" required placeholder="e.g. Ada Okafor">
                      </label>
                      <label>
                        Role
                        <select name="role" required>
                          <option value="cashier">Cashier</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                      <label>
                        Email address
                        <input name="email" type="email" autocomplete="email" required placeholder="staff@yourstore.com">
                      </label>
                      <label>
                        Phone number
                        <input name="phone" type="tel" autocomplete="tel" placeholder="Optional">
                      </label>
                    </div>
                    <label>
                      Temporary password
                      <input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters">
                    </label>
                    ${staffPhotoField('new-staff-portrait')}
                    <div class="staff-form-note">
                      <strong>Keep access private</strong>
                      <span>Share the temporary password securely. Staff use these details to sign in to the QuickPOS app.</span>
                    </div>
                    <button class="button" type="submit">Create staff account</button>
                  </form>
                ` : `
                  <div class="staff-locked-state">
                    <strong>Activate staff creation</strong>
                    <p>Complete or renew your QuickPOS subscription before adding manager, admin, or cashier accounts.</p>
                    <button class="button" type="button" data-account-open-section="billing">Open billing</button>
                  </div>
                `}
              </article>

              <article class="staff-directory-card">
                <div class="staff-card-heading">
                  <div>
                    <span class="section-kicker">Directory</span>
                    <h3>Your team</h3>
                  </div>
                  <span>${escapeHtml(String(staff.filter((member) => member.is_active !== false).length))} active</span>
                </div>
                <p class="account-muted">${subscription?.paid_staff_tools ? 'Use ID card next to a manager or admin to print both sides. Managers issue cashier cards from their own sign-in.' : 'Printable staff ID cards require an active paid subscription.'}</p>
                ${renderStaffDirectory(staff, user, { paidTools: subscription?.paid_staff_tools })}
              </article>
            </div>
          </section>

          <section class="account-panel account-billing-panel" data-account-panel="billing" ${activeSection === 'billing' ? '' : 'hidden'}>
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Billing</span>
                <h2 tabindex="-1">${activation ? 'Activate your store' : 'Manage subscription'}</h2>
                <p>${activation ? 'Pay once to unlock five months of QuickPOS and download the app. No automatic renewal.' : 'Review your access, billing plans, and confirmed payments.'}</p>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${escapeHtml(subscriptionStatusLabel(subscription))}</span>
            </div>
            ${activation ? checkout : `
            <div class="billing-status-band">
              <div>
                <span>Subscription status</span>
                <strong>${escapeHtml(subscriptionStatusLabel(subscription))}</strong>
                <p>${escapeHtml(statusCopy(subscription))}</p>
              </div>
              <div>
                <span>Next action</span>
                <strong>${escapeHtml(billingNextAction(subscription))}</strong>
                <p>Payments are approved automatically only after the selected provider confirms them.</p>
              </div>
            </div>
            <div class="billing-summary-grid">
              <article>
                <span>Account access</span>
                <strong>${unlocked ? 'Full access' : 'Limited access'}</strong>
                <p>${unlocked ? 'Sales, staff, reports, inventory, and downloads are available.' : 'Complete payment to unlock the full product.'}</p>
              </article>
              <article>
                <span>Current plan</span>
                <strong>${escapeHtml(subscription?.plan_name || (subscription?.plan_code ? paymentPlanName(subscription.plan_code) : '') || (subscription?.activation_required ? 'Activation required' : 'Not selected'))}</strong>
                <p>${subscription?.recurring ? 'Renews automatically until cancelled.' : 'No automatic renewal is active.'}</p>
              </article>
              <article>
                <span>Access through</span>
                <strong>${subscription?.current_period_end ? formatDate(subscription.current_period_end) : subscription?.trial_ends_at ? formatDate(subscription.trial_ends_at) : 'Not active'}</strong>
                <p>${unlocked ? 'Your store currently has full write access.' : 'Complete payment to unlock full access.'}</p>
              </article>
            </div>
            ${checkout}
            `}
            <div class="account-subpanel billing-history-panel">
              <div class="billing-history-heading">
                <div>
                  <span class="section-kicker">Transactions</span>
                  <h3>Payment history</h3>
                  <p>Only payments confirmed by your payment provider are shown here.</p>
                </div>
                <span>${confirmedTransactions.length ? `${confirmedTransactions.length} confirmed ${confirmedTransactions.length === 1 ? 'payment' : 'payments'}` : 'No payments yet'}</span>
              </div>
              ${renderTransactions(confirmedTransactions)}
            </div>
          </section>

          <section class="account-panel" data-account-panel="downloads" ${activeSection === 'downloads' ? '' : 'hidden'}>
            <div class="account-panel-heading">
              <div>
                <span class="section-kicker">Downloads</span>
                <h2 tabindex="-1">${unlocked ? 'Choose your device' : 'Downloads unlock after activation'}</h2>
              </div>
              <span class="account-badge ${unlocked ? 'success' : 'warning'}">${unlocked ? 'Unlocked' : 'Locked'}</span>
            </div>
            ${unlocked ? `
              <div class="download-experience account-download-experience" data-account-download-grid>
                <div class="download-loading"><span class="download-spinner"></span>Loading your verified downloads…</div>
              </div>
            ` : `
              <div class="account-locked-downloads">
                <strong>Pay activation first.</strong>
                <p>Once payment is confirmed, this section will show Windows, Android, macOS, and Linux installers. The installed app uses the same login, but the website never opens the POS interface.</p>
                <button class="button" type="button" data-account-open-section="billing">Go to billing</button>
              </div>
            `}
          </section>
        </div>
      </div>
    </section>
  `;

  if (flash) {
    setFlash(typeof flash === 'string' ? flash : flash.message, typeof flash === 'string' ? 'success' : flash.type);
  }
  attachPortalHandlers();
  activatePortalSection(activeSection, { focus });
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

function attachSignOutHandler() {
  document.getElementById('account-logout')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await siteApi.post('/auth/logout', {});
    } catch {
      // Local sign-out should still complete.
    }
    siteApi.clearSession();
    window.history.replaceState({}, '', `${window.location.pathname}#signin`);
    renderSignIn();
  });
}

function attachStaffCardHandlers() {
  root.querySelectorAll('[data-account-staff-card]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { openWebsiteStaffCard } = await import('./staff-card.js');
        await openWebsiteStaffCard(siteApi, Number(button.dataset.accountStaffCard), button);
      } catch (error) { setFlash(error.message || 'Could not open the staff card.', 'error'); }
      finally { button.disabled = false; }
    });
  });
}

function attachPortalHandlers() {
  document.querySelectorAll('[data-account-section-link]').forEach((button) => {
    button.addEventListener('click', () => {
      openPortalSection(button.dataset.accountSectionLink);
    });
  });

  document.querySelectorAll('[data-account-open-section]').forEach((button) => {
    button.addEventListener('click', () => {
      openPortalSection(button.dataset.accountOpenSection);
    });
  });

  attachSignOutHandler();
  attachStaffCardHandlers();

  document.getElementById('account-profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const payload = payloadFromForm(event.target, ['password']);
    button.disabled = true;
    button.textContent = 'Saving…';
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
    button.textContent = 'Saving…';
    try {
      await siteApi.patch('/account/store', payload);
      await loadPortal('Store settings updated.');
    } catch (error) {
      setFlash(error.message || 'Could not update store settings', 'error');
      button.disabled = false;
      button.textContent = 'Save store settings';
    }
  });

  const staffForm = document.getElementById('account-staff-form');
  if (staffForm) bindStaffPhotoField(staffForm);
  staffForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const payload = payloadFromForm(form, ['phone']);
    button.disabled = true;
    button.textContent = 'Creating account…';
    try {
      payload.staff_photo = await readStaffPhoto(form);
      await siteApi.post('/settings/users', payload);
      await loadPortal(`${payload.name} was added as a ${payload.role}.`);
    } catch (error) {
      setFlash(error.message || 'Could not create staff account', 'error');
      button.disabled = false;
      button.textContent = 'Create staff account';
    }
  });

  document.querySelectorAll('[data-account-staff-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      try {
        const member = JSON.parse(decodeURIComponent(button.dataset.accountStaffEdit || '{}'));
        showAccountStaffEditModal(member);
      } catch {
        setFlash('Could not open that staff account. Refresh and try again.', 'error');
      }
    });
  });

  document.querySelectorAll('[data-account-staff-archive]').forEach((button) => {
    button.addEventListener('click', async () => {
      const staffId = button.dataset.accountStaffArchive;
      if (!staffId || !confirm('Delete this staff account and sign them out of QuickPOS?')) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Deleting…';
      try {
        await siteApi.delete(`/account/staff/${staffId}`);
        await loadPortal('Staff account deleted.');
      } catch (error) {
        setFlash(error.message || 'Could not archive staff account', 'error');
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });

  attachBillingHandlers();
}

function attachBillingHandlers() {
  document.querySelector('[data-check-payment]')?.addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Checking…';
    bootstrap();
  });
  attachCheckoutHandler();
}

function attachCheckoutHandler() {
  const form = document.getElementById('account-checkout-form');
  if (!form) return;

  const plan = form.elements.namedItem('plan_code');
  const consent = form.elements.namedItem('legal_acknowledged');
  const providers = [...form.querySelectorAll('input[name="provider"]')];
  const providerGroup = form.querySelector('.billing-provider-fieldset');
  const button = form.querySelector('[type="submit"]');
  const requestError = form.querySelector('[data-checkout-error]');
  const currency = form.dataset.currency;
  const total = form.querySelector('[data-checkout-total]');
  const cadence = form.querySelector('[data-checkout-cadence]');
  const renewal = form.querySelector('[data-checkout-renewal]');
  const currentProvider = () => providers.find((option) => option.checked && !option.disabled);
  const selectedPlan = () => plan instanceof HTMLSelectElement ? plan.selectedOptions[0] : plan;

  function fieldError(field, id, message = '', focusTarget = field) {
    const error = form.querySelector(`#${id}`);
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
    if (message) {
      field.setAttribute('aria-invalid', 'true');
      focusTarget?.focus();
    } else {
      field.removeAttribute('aria-invalid');
    }
  }

  function syncOptions() {
    const choice = selectedPlan();
    const available = choice?.dataset.providerOptions?.split(' ').filter(Boolean) || [];
    for (const option of providers) {
      option.disabled = !available.includes(option.value);
      if (option.disabled) option.checked = false;
      else if (available.length === 1) option.checked = true;
      option.closest('label').querySelector('[data-billing-provider-status]').textContent = option.disabled
        ? (plan.value ? 'Unavailable for this plan' : 'Choose a plan first')
        : `Available in ${currency}`;
    }
    total.textContent = choice?.dataset.total || '—';
    cadence.textContent = `${currency}${choice?.dataset.cadence ? ` · ${choice.dataset.cadence}` : ''}`;
    renewal.textContent = !plan.value ? 'Choose a plan to see the amount and renewal schedule.'
      : plan.value === 'activation_5m' ? 'Five months of full access. Does not auto-renew.'
        : choice.dataset.recurring === 'true' ? 'Renews automatically until cancelled.' : 'Does not auto-renew.';
    const provider = currentProvider();
    button.textContent = provider ? `Continue to ${CHECKOUT_PROVIDERS[provider.value]}` : 'Continue to secure payment';
  }

  const clearRequestError = () => { requestError.hidden = true; requestError.textContent = ''; };
  function restoreCheckout() {
    button.disabled = plan.disabled = consent.disabled = false;
    syncOptions();
  }
  plan.addEventListener('change', () => {
    fieldError(plan, 'account-plan-error');
    fieldError(providerGroup, 'account-provider-error');
    clearRequestError();
    syncOptions();
  });
  providerGroup.addEventListener('change', () => {
    fieldError(providerGroup, 'account-provider-error');
    clearRequestError();
    syncOptions();
  });
  consent.addEventListener('change', () => fieldError(consent, 'account-consent-error'));
  syncOptions();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    clearRequestError();
    const provider = currentProvider();
    if (!plan.value || selectedPlan()?.disabled) {
      fieldError(plan, 'account-plan-error', 'Choose a billing plan to continue.');
    } else if (!provider) {
      fieldError(providerGroup, 'account-provider-error', 'Choose a payment provider to continue.', providers.find((option) => !option.disabled));
    } else if (!consent.checked) {
      fieldError(consent, 'account-consent-error', 'Check the agreement to continue to payment.');
    } else {
      const payload = {
        provider: provider.value,
        plan_code: plan.value,
        currency,
        locale: navigator.language || '',
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        legal_acknowledged: consent.checked,
      };
      button.disabled = true;
      button.textContent = 'Opening secure checkout…';
      plan.disabled = consent.disabled = true;
      providers.forEach((option) => { option.disabled = true; });
      try {
        const checkout = await siteApi.post('/billing/checkout', payload);
        if (!checkout.authorization_url) throw new Error('The payment provider didn’t return a checkout link. Please try again.');
        window.location.assign(checkout.authorization_url);
        window.addEventListener('pageshow', () => {
          if (form.isConnected) restoreCheckout();
        }, { once: true });
      } catch (error) {
        restoreCheckout();
        requestError.textContent = error.message || 'Could not start checkout. Please try again.';
        requestError.hidden = false;
        requestError.focus();
      }
    }
  });
}

function returnedPayment(params) {
  const transactionId = params.get('transaction_id') || '';
  const flutterwaveReference = params.get('tx_ref') || '';
  const paystackReference = params.get('reference') || params.get('trxref') || '';
  const reference = flutterwaveReference || paystackReference;
  const status = params.get('status')?.trim().toLowerCase() || '';
  if (!reference && !transactionId && !status && params.get('payment_return') !== '1') return null;
  return {
    provider: flutterwaveReference || transactionId ? 'flutterwave' : 'paystack',
    reference,
    transaction_id: transactionId || undefined,
    status,
  };
}

async function confirmReturnedPayment(payment) {
  const routeTo = (section) => window.history.replaceState({}, '', `${window.location.pathname}#${section}`);
  const failed = () => {
    routeTo('billing');
    return { message: 'Checkout did not complete. If you see a charge, contact support before retrying.', type: 'info' };
  };
  if (['cancelled', 'canceled', 'failed', 'abandoned', 'expired', 'error', 'reversed'].includes(payment.status)) return failed();
  if (!payment.reference) {
    routeTo('billing');
    return { message: 'No payment was confirmed. If you see a charge, contact support before retrying.', type: 'info' };
  }

  const result = await siteApi.post('/billing/confirm', payment);
  if (result.failed) return failed();
  if (result.confirmed) {
    const unlocked = downloadsUnlocked(result.subscription);
    routeTo(unlocked ? 'downloads' : 'billing');
    return { message: unlocked ? 'Payment confirmed. Your store is active and downloads are unlocked.' : 'Payment confirmed. See your current access and payment history in Billing.', type: 'success' };
  }
  if (result.duplicate_review) {
    routeTo('billing');
    return { message: 'Payment received. A possible duplicate charge has been flagged for support review.', type: 'info' };
  }
  return { message: 'The payment provider hasn’t confirmed your payment yet.', type: 'info' };
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

function keepManagerStaffRoute() {
  if (routeInfo().mode !== 'staff' || window.location.search) {
    history.replaceState(null, '', `${window.location.pathname}#staff`);
  }
}

async function renderManagerStaff({ user, subscription }, { focus = false } = {}) {
  keepManagerStaffRoute();
  const paidTools = Boolean(subscription?.paid_staff_tools);
  const { users = [] } = paidTools ? await siteApi.get('/settings/users') : {};
  const cashiers = users.filter((member) => member.role === 'cashier');
  if (!siteApi.accessToken) return;
  root.innerHTML = `
    <section class="section account-section" data-manager-staff>
      <div class="site-shell account-panel account-staff-panel">
        <div class="account-panel-heading">
          <div><h1 tabindex="-1">${paidTools ? 'Cashier ID cards' : 'Store access requires payment'}</h1>${paidTools ? '<p>Print or revoke register cards for cashiers in your store.</p>' : ''}</div>
          <button type="button" class="button button-secondary" id="account-logout">Sign out</button>
        </div>
        <div data-account-alert></div>
        <div class="staff-directory-card">
          ${paidTools ? renderStaffDirectory(cashiers, user, { paidTools, readOnly: true }) : `
            <p class="account-muted">Ask your store admin to ${subscription?.activation_required ? 'activate QuickPOS' : 'renew QuickPOS'} to restore access.</p>
            <a class="button button-secondary" href="/support">Contact support</a>`}
        </div>
      </div>
    </section>`;
  attachSignOutHandler();
  attachStaffCardHandlers();
  if (focus) root.querySelector('h1')?.focus();
}

async function loadPortal(flash = '', { focus = false } = {}) {
  root.innerHTML = `
    <section class="page-hero account-hero">
      <div class="site-shell">
        <div class="download-loading"><span class="download-spinner"></span>Loading your QuickPOS account…</div>
      </div>
    </section>
  `;

  try {
    const identity = await siteApi.get('/auth/me');
    updateStoreAccess(identity.subscription);
    if (identity.user?.role === 'manager') {
      siteApi.updateUser(identity.user);
      await renderManagerStaff(identity, { focus });
      return;
    }
    if (identity.user?.role !== 'admin') {
      siteApi.clearSession();
      renderAdminOnly();
      return;
    }
    if (readSiteSession().user?.role !== 'admin') siteApi.updateUser(identity.user);
    const overview = await siteApi.get('/account/overview');

    const billingHints = new URLSearchParams({
      locale: navigator.language || '',
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    });
    const [plansResult, statusResult] = await Promise.all([
      siteApi.get(`/billing/plans?${billingHints}`),
      siteApi.get('/billing/status'),
    ]);
    const subscription = statusResult.subscription || overview.subscription;
    updateStoreAccess(subscription);
    const [transactionsResult, staffResult] = needsInitialActivation(subscription) ? [{}, {}] : await Promise.all([
      siteApi.get('/billing/transactions'),
      siteApi.get('/settings/users'),
    ]);

    renderPortal({
      overview: { ...overview, subscription },
      plans: plansResult.plans || [],
      billingCurrency: plansResult.currency?.recommended || '',
      transactions: transactionsResult.transactions || [],
      staff: staffResult.users || [],
    }, flash, { focus });
  } catch (error) {
    siteApi.clearSession();
    renderSignIn();
    setFlash(error.message || 'Session expired. Please sign in again.', 'error');
  }
}

async function bootstrap() {
  if (!root) return;
  const { mode, params } = routeInfo();
  const payment = returnedPayment(params);

  if (mode === 'reset-password' || params.get('token')) {
    renderResetPassword();
    return;
  }
  if (!payment && siteApi.accessToken && ['signin', 'login', 'create', 'register', 'signup', 'forgot-password'].includes(mode)) {
    window.location.replace(readSiteSession().user?.role === 'manager' ? '#staff' : '#overview');
    return;
  }
  if (!payment && mode === 'forgot-password') {
    renderForgotPassword();
    return;
  }
  if (!payment && ['create', 'register', 'signup'].includes(mode)) {
    renderRegister();
    return;
  }
  if (!siteApi.accessToken) {
    renderSignIn();
    return;
  }
  if (readSiteSession().user?.role === 'manager') {
    await loadPortal('', { focus: true });
    return;
  }
  if (!payment) {
    await loadPortal();
    return;
  }
  if (checkingPayment) return;
  checkingPayment = true;
  try {
    let flash;
    window.history.replaceState({}, '', `${window.location.pathname}?${params}#billing`);
    try {
      flash = await confirmReturnedPayment(payment);
    } catch (error) {
      flash = { message: error.message || 'Couldn’t check this payment right now.', type: 'error' };
    }
    await loadPortal(flash, { focus: true });
  } finally {
    checkingPayment = false;
  }
}

function handleAccountNavigation() {
  if (checkPaidTerm()) return;
  const { mode, params } = routeInfo();
  if (siteApi.accessToken && document.querySelector('[data-manager-staff]') &&
      mode !== 'reset-password' && !params.has('token')) {
    keepManagerStaffRoute();
    return;
  }
  if (returnedPayment(params)) {
    bootstrap();
    return;
  }
  if (siteApi.accessToken && document.querySelector('[data-account-gate]')) {
    keepActivationRoute();
    return;
  }
  if (siteApi.accessToken && PORTAL_SECTIONS.includes(mode) && document.querySelector('[data-account-portal]')) {
    activatePortalSection(mode, { focus: true });
    return;
  }
  bootstrap();
}

function checkPaidTerm() {
  if (!siteApi.accessToken || Date.now() < paidThrough || !Number.isFinite(paidThrough)) return false;
  paidThrough = Infinity;
  document.body.setAttribute('data-account-access-locked', '');
  document.querySelector('.site-card-dialog[open]')?.close();
  document.querySelectorAll('.account-modal-overlay').forEach((dialog) => dialog.remove());
  loadPortal('', { focus: true });
  return true;
}

window.addEventListener('hashchange', handleAccountNavigation);
window.addEventListener('popstate', handleAccountNavigation);
window.addEventListener('focus', checkPaidTerm);
if (root) window.setInterval(checkPaidTerm, 60_000);
bootstrap();
