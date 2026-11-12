import './styles.css';

const app = document.getElementById('app');
const liveStatus = document.getElementById('live-status');
const PRODUCTION_API_BASE = 'https://pos-server-six.vercel.app/api/v1';

function resolveApiBase(rawValue, { development = false } = {}) {
  const fallback = development ? '/api/v1' : PRODUCTION_API_BASE;
  const value = rawValue?.trim();
  if (!value) return fallback;
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/v1';
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, {
  development: import.meta.env.DEV,
});

const SESSION_KEY = 'qp_control_access_token';
const USER_KEY = 'qp_control_user';
const views = ['overview', 'stores', 'payments'];

const icons = {
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  stores: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5 5 4h14l2 5.5M5 13v7h14v-7M9 20v-5h6v5"/><path d="M3 9.5c0 1.4 1 2.5 2.3 2.5S7.7 11 8 9.5C8.3 11 9.4 12 10.7 12s2.3-1 2.6-2.5c.3 1.5 1.4 2.5 2.7 2.5s2.3-1 2.6-2.5c.3 1.5 1.3 2.5 2.4 2.5"/></svg>',
  payments: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  install: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.7-2L20 12M4 12l2.2 5a7 7 0 0 0 11.7-2"/></svg>',
};

const state = {
  view: 'overview',
  user: null,
  overview: null,
  payments: null,
  search: '',
  status: 'all',
  page: 1,
  loading: false,
  installPrompt: null,
  pendingConfirmation: null,
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function announce(message) {
  liveStatus.textContent = '';
  window.setTimeout(() => { liveStatus.textContent = message; }, 10);
}

function formatDate(value, withTime = false) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function formatMoney(value, currency = 'NGN') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'NGN',
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(Number(value || 0));
}

function titleCase(value = '') {
  return String(value || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status = '') {
  if (['active', 'grandfathered', 'success'].includes(status)) return 'success';
  if (['pending_activation', 'initialized', 'trialing'].includes(status)) return 'warning';
  if (['failed', 'past_due', 'expired'].includes(status)) return 'danger';
  return 'neutral';
}

class ControlApi {
  constructor() {
    this.accessToken = localStorage.getItem(SESSION_KEY);
  }

  storeSession(data) {
    this.accessToken = data.accessToken;
    localStorage.setItem(SESSION_KEY, data.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user || {}));
  }

  clearSession() {
    this.accessToken = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async refresh() {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-QuickPOS-Client': 'website',
        },
        body: '{}',
      });
      if (!response.ok) return false;
      const body = await response.json();
      this.accessToken = body.accessToken;
      localStorage.setItem(SESSION_KEY, body.accessToken);
      return true;
    } catch {
      return false;
    }
  }

  async request(path, options = {}, retry = true) {
    const headers = {
      'Content-Type': 'application/json',
      'X-QuickPOS-Client': 'website',
      ...(options.headers || {}),
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers,
    });
    if (response.status === 401 && this.accessToken && retry && await this.refresh()) {
      return this.request(path, options, false);
    }
    let body = {};
    try { body = await response.json(); } catch { /* JSON is expected, but keep a useful fallback. */ }
    if (!response.ok) {
      const error = new Error(body.error || `Request failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  get(path) { return this.request(path); }
  patch(path, body) { return this.request(path, { method: 'PATCH', body: JSON.stringify(body) }); }
}

const api = new ControlApi();

function brand() {
  return `
    <span class="brand-mark"><img src="/brand/quickpos-mark.svg" alt="" width="40" height="40"></span>
    <span class="brand-copy"><strong>QP Control</strong><small>Private operations</small></span>
  `;
}

function renderSignIn(message = '') {
  document.body.dataset.authenticated = 'false';
  app.innerHTML = `
    <main class="auth-layout" id="main-content" tabindex="-1">
      <section class="auth-panel" aria-labelledby="signin-title">
        <div class="auth-brand">${brand()}</div>
        <div class="auth-copy">
          <span class="eyebrow">Restricted access</span>
          <h1 id="signin-title">Sign in to control.</h1>
          <p>Review registrations, verified payments, store access, and customer accounts from one secure workspace.</p>
        </div>
        <form class="signin-form" data-signin-form novalidate>
          <label for="signin-email">Email address</label>
          <input id="signin-email" name="email" type="email" autocomplete="username" inputmode="email" spellcheck="false" required>
          <label for="signin-password">Password</label>
          <div class="password-field">
            <input id="signin-password" name="password" type="password" autocomplete="current-password" required>
            <button class="password-toggle" type="button" data-password-toggle aria-controls="signin-password" aria-pressed="false">Show password</button>
          </div>
          <p class="form-error" role="alert" data-form-error>${escapeHtml(message)}</p>
          <button class="button primary" type="submit">Sign in securely</button>
        </form>
        <p class="auth-note">The private address is not a security key. Access is enforced again by the QuickPOS server.</p>
      </section>
      <aside class="auth-context" aria-label="Workspace capabilities">
        <div class="context-figure" aria-hidden="true">
          <span></span><span></span><span></span>
          <b>Live account controls</b>
        </div>
        <dl>
          <div><dt>Registrations</dt><dd>See store owners as soon as they create an account.</dd></div>
          <div><dt>Payments</dt><dd>Distinguish verified payment from an attempted checkout.</dd></div>
          <div><dt>Access</dt><dd>Disable a customer sign-in and revoke active sessions when required.</dd></div>
        </dl>
      </aside>
    </main>
  `;
  document.getElementById('main-content')?.focus();
}

function navButton(view, label) {
  return `
    <button type="button" class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>
      ${icons[view]}<span>${label}</span>
    </button>
  `;
}

function renderShell() {
  document.body.dataset.authenticated = 'true';
  const initial = String(state.user?.name || state.user?.email || 'Q').charAt(0).toUpperCase();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Primary navigation">
        <a class="sidebar-brand" href="#overview" data-view-link="overview" aria-label="QP Control overview">${brand()}</a>
        <nav class="side-nav">
          ${navButton('overview', 'Overview')}
          ${navButton('stores', 'Stores')}
          ${navButton('payments', 'Payments')}
        </nav>
        <div class="sidebar-foot">
          <button type="button" class="install-button" data-install hidden>${icons.install}<span>Install app</span></button>
          <div class="signed-in-user"><span aria-hidden="true">${escapeHtml(initial)}</span><div><strong>${escapeHtml(state.user?.name || 'Platform owner')}</strong><small>${escapeHtml(state.user?.email || '')}</small></div></div>
          <button type="button" class="text-button" data-signout>Sign out</button>
        </div>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div>
            <span class="eyebrow">QuickPOS operations</span>
            <h1 data-page-title>Overview</h1>
          </div>
          <div class="topbar-actions">
            <button type="button" class="icon-button" data-install aria-label="Install QP Control app" title="Install app" hidden>${icons.install}</button>
            <button type="button" class="icon-button" data-refresh aria-label="Refresh current data" title="Refresh">${icons.refresh}</button>
            <span class="connection-state"><i aria-hidden="true"></i>Live</span>
          </div>
        </header>
        <main class="main-content" id="main-content" tabindex="-1"></main>
      </div>
      <nav class="bottom-nav" aria-label="Primary navigation">
        ${navButton('overview', 'Overview')}
        ${navButton('stores', 'Stores')}
        ${navButton('payments', 'Payments')}
      </nav>
    </div>
    <dialog class="detail-dialog" data-store-dialog aria-labelledby="store-dialog-title">
      <div class="dialog-shell" data-store-dialog-content></div>
    </dialog>
    <dialog class="confirm-dialog" data-confirm-dialog aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <form method="dialog" class="confirm-shell">
        <span class="confirm-mark" aria-hidden="true">!</span>
        <h2 id="confirm-title" data-confirm-title>Confirm change</h2>
        <p id="confirm-description" data-confirm-description></p>
        <div class="dialog-actions">
          <button class="button secondary" value="cancel">Cancel</button>
          <button class="button danger" value="confirm" data-confirm-submit>Confirm</button>
        </div>
      </form>
    </dialog>
  `;
  syncInstallButtons();
}

function loadingMarkup(label = 'Loading current data') {
  return `<div class="loading-state" role="status"><span aria-hidden="true"></span><strong>${escapeHtml(label)}…</strong></div>`;
}

function emptyMarkup(title, body) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>`;
}

function paymentRow(payment, compact = false) {
  return `
    <li class="payment-row">
      <span class="payment-provider">${escapeHtml(String(payment.provider || 'payment').charAt(0).toUpperCase())}</span>
      <div class="row-main">
        <strong>${escapeHtml(payment.store_name || 'Unknown store')}</strong>
        <span>${escapeHtml(titleCase(payment.plan_code))} · ${escapeHtml(payment.provider_reference || 'No reference')}</span>
      </div>
      <div class="row-value">
        <strong>${escapeHtml(formatMoney(payment.amount, payment.currency))}</strong>
        <span>${escapeHtml(formatDate(payment.paid_at || payment.created_at, !compact))}</span>
      </div>
      <span class="status-badge ${statusTone(payment.status)}">${escapeHtml(titleCase(payment.status))}</span>
    </li>
  `;
}

function storeRow(store) {
  const paid = Boolean(store.payment_paid_at);
  const access = store.owner_is_active !== false;
  return `
    <li>
      <button class="store-row" type="button" data-store-id="${escapeHtml(store.id)}" aria-label="Open ${escapeHtml(store.name)} account">
        <span class="store-avatar" aria-hidden="true">${escapeHtml(String(store.name || 'S').charAt(0).toUpperCase())}</span>
        <span class="row-main">
          <strong>${escapeHtml(store.name)}</strong>
          <span>${escapeHtml(store.owner_name || 'No owner name')} · ${escapeHtml(store.owner_email || store.email || 'No email')}</span>
        </span>
        <span class="row-meta">
          <span class="status-badge ${paid ? 'success' : 'warning'}">${paid ? 'Paid' : 'Awaiting payment'}</span>
          <small>${access ? 'Sign-in active' : 'Sign-in disabled'}</small>
        </span>
        <span class="row-date"><strong>${escapeHtml(formatDate(store.created_at))}</strong><small>Registered</small></span>
        <span class="row-arrow">${icons.arrow}</span>
      </button>
    </li>
  `;
}

function totalsMarkup(totals = []) {
  if (!totals.length) return 'No verified payments';
  return totals.map((total) => formatMoney(total.amount, total.currency)).join(' · ');
}

function overviewMarkup(data) {
  const summary = data.summary || {};
  return `
    <section class="dashboard-intro" aria-labelledby="dashboard-heading">
      <div><span class="section-label">Today’s control room</span><h2 id="dashboard-heading">Know who joined and who paid.</h2></div>
      <p>Payment totals only include provider-confirmed transactions. An attempted checkout does not count as paid.</p>
    </section>
    <dl class="metrics" aria-label="Account summary">
      <div><dt>Registered stores</dt><dd>${escapeHtml(summary.registered_stores || 0)}</dd><span>${escapeHtml(summary.registered_last_7_days || 0)} in the last 7 days</span></div>
      <div><dt>Stores with payment</dt><dd>${escapeHtml(summary.paid_stores || 0)}</dd><span>At least one verified payment</span></div>
      <div><dt>Awaiting payment</dt><dd>${escapeHtml(summary.pending_stores || 0)}</dd><span>Registered without a verified payment</span></div>
      <div class="metric-wide"><dt>Verified revenue</dt><dd>${escapeHtml(totalsMarkup(summary.payment_totals))}</dd><span>${escapeHtml((summary.payment_totals || []).reduce((sum, item) => sum + Number(item.count || 0), 0))} successful transactions</span></div>
    </dl>
    <section class="data-section" aria-labelledby="recent-stores-title">
      <div class="section-heading"><div><span class="section-label">Newest accounts</span><h2 id="recent-stores-title">Recent registrations</h2></div><button type="button" class="text-button arrow-button" data-view="stores">See all stores ${icons.arrow}</button></div>
      ${(data.stores || []).length
        ? `<ul class="data-list store-list">${data.stores.slice(0, 6).map(storeRow).join('')}</ul>`
        : emptyMarkup('No registrations yet', 'New QuickPOS store registrations will appear here.')}
    </section>
    <section class="data-section" aria-labelledby="recent-payments-title">
      <div class="section-heading"><div><span class="section-label">Provider-confirmed</span><h2 id="recent-payments-title">Recent payments</h2></div><button type="button" class="text-button arrow-button" data-view="payments">See all payments ${icons.arrow}</button></div>
      ${(data.recent_payments || []).length
        ? `<ul class="data-list payment-list">${data.recent_payments.map((payment) => paymentRow(payment, true)).join('')}</ul>`
        : emptyMarkup('No verified payments yet', 'Successful Paystack and Flutterwave payments will appear here.')}
    </section>
  `;
}

function filterBar(kind) {
  const isStores = kind === 'stores';
  const options = isStores
    ? [['all', 'All stores'], ['paid', 'Paid'], ['pending', 'Awaiting payment'], ['active', 'Active access'], ['inactive', 'Inactive access']]
    : [['all', 'All payments'], ['success', 'Successful'], ['initialized', 'Attempted'], ['failed', 'Failed'], ['paid_duplicate', 'Duplicate']];
  return `
    <form class="filter-bar" data-filter-form>
      <label class="search-field">
        <span class="sr-only">Search ${isStores ? 'stores or owners' : 'payments'}</span>
        ${icons.search}
        <input name="search" type="search" value="${escapeHtml(state.search)}" placeholder="${isStores ? 'Search store, owner, or email…' : 'Search store or reference…'}" autocomplete="off" spellcheck="false">
      </label>
      <label class="select-field">
        <span class="sr-only">Filter status</span>
        <select name="status">
          ${options.map(([value, label]) => `<option value="${value}" ${state.status === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <button class="button secondary filter-submit" type="submit">Apply</button>
    </form>
  `;
}

function paginationMarkup(pagination = {}) {
  const page = Number(pagination.page || 1);
  const totalPages = Math.max(1, Math.ceil(Number(pagination.total || 0) / Number(pagination.limit || 20)));
  return `
    <nav class="pagination" aria-label="Result pages">
      <button type="button" class="button secondary" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${page} of ${totalPages} · ${Number(pagination.total || 0)} results</span>
      <button type="button" class="button secondary" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next</button>
    </nav>
  `;
}

function storesMarkup(data) {
  return `
    <section class="page-intro"><div><span class="section-label">Customer accounts</span><h2>Stores</h2></div><p>Search every registration, confirm payment state, and open an account to manage customer sign-in access.</p></section>
    ${filterBar('stores')}
    <section class="data-section data-section-full" aria-label="Store directory">
      ${(data.stores || []).length
        ? `<ul class="data-list store-list">${data.stores.map(storeRow).join('')}</ul>`
        : emptyMarkup('No stores match this filter', 'Change the search or status filter and try again.')}
      ${paginationMarkup(data.pagination)}
    </section>
  `;
}

function paymentsMarkup(data) {
  return `
    <section class="page-intro"><div><span class="section-label">Billing record</span><h2>Payments</h2></div><p>Review successful transactions separately from checkout attempts, failures, and duplicate activation payments.</p></section>
    ${filterBar('payments')}
    <section class="data-section data-section-full" aria-label="Payment directory">
      ${(data.payments || []).length
        ? `<ul class="data-list payment-list">${data.payments.map((payment) => paymentRow(payment)).join('')}</ul>`
        : emptyMarkup('No payments match this filter', 'Change the search or status filter and try again.')}
      ${paginationMarkup(data.pagination)}
    </section>
  `;
}

function syncNavigation() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const titles = { overview: 'Overview', stores: 'Stores', payments: 'Payments' };
  const title = document.querySelector('[data-page-title]');
  if (title) title.textContent = titles[state.view];
  document.title = `${titles[state.view]} · QP Control`;
}

function syncUrlState() {
  const params = new URLSearchParams();
  if (state.view !== 'overview') {
    if (state.search) params.set('search', state.search);
    if (state.status !== 'all') params.set('status', state.status);
    if (state.page > 1) params.set('page', String(state.page));
  }
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}#${state.view}`);
}

async function loadCurrentView({ focus = false } = {}) {
  const content = document.getElementById('main-content');
  if (!content) return;
  state.loading = true;
  content.setAttribute('aria-busy', 'true');
  content.innerHTML = loadingMarkup();
  syncNavigation();
  try {
    if (state.view === 'overview') {
      const data = await api.get('/platform/overview?limit=10');
      state.overview = data;
      content.innerHTML = overviewMarkup(data);
    } else if (state.view === 'stores') {
      const params = new URLSearchParams({
        search: state.search,
        status: state.status,
        page: String(state.page),
        limit: '20',
      });
      const data = await api.get(`/platform/overview?${params}`);
      state.overview = data;
      content.innerHTML = storesMarkup(data);
    } else {
      const params = new URLSearchParams({
        search: state.search,
        status: state.status,
        page: String(state.page),
        limit: '20',
      });
      const data = await api.get(`/platform/payments?${params}`);
      state.payments = data;
      content.innerHTML = paymentsMarkup(data);
    }
    content.removeAttribute('aria-busy');
    if (focus) content.focus();
    announce(`${document.querySelector('[data-page-title]')?.textContent || 'Page'} data loaded`);
  } catch (error) {
    content.removeAttribute('aria-busy');
    if (error.status === 401 || error.status === 403) {
      api.clearSession();
      renderSignIn(error.status === 403 ? 'This account does not have platform access.' : 'Your session has ended. Sign in again.');
      return;
    }
    content.innerHTML = `<div class="error-state" role="alert"><strong>Could not load current data</strong><p>${escapeHtml(error.message)}</p><button class="button secondary" type="button" data-refresh>Try again</button></div>`;
  } finally {
    state.loading = false;
  }
}

async function changeView(view) {
  if (!views.includes(view) || state.loading) return;
  state.view = view;
  state.search = '';
  state.status = 'all';
  state.page = 1;
  syncUrlState();
  await loadCurrentView({ focus: true });
}

function storeDialogMarkup(data) {
  const store = data.store;
  return `
    <header class="dialog-header">
      <div><span class="section-label">Store #${escapeHtml(store.id)}</span><h2 id="store-dialog-title">${escapeHtml(store.name)}</h2><p>${escapeHtml(store.email || 'No store email')} · Registered ${escapeHtml(formatDate(store.created_at))}</p></div>
      <button class="icon-button" type="button" data-dialog-close aria-label="Close store details">${icons.close}</button>
    </header>
    <div class="detail-summary">
      <div><span>Subscription</span><strong>${escapeHtml(titleCase(store.subscription_status))}</strong></div>
      <div><span>Plan</span><strong>${escapeHtml(titleCase(store.plan_code || 'Not selected'))}</strong></div>
      <div><span>Paid through</span><strong>${escapeHtml(formatDate(store.current_period_end))}</strong></div>
    </div>
    <section class="dialog-section" aria-labelledby="store-users-title">
      <div class="section-heading"><div><span class="section-label">People</span><h3 id="store-users-title">Store accounts</h3></div></div>
      <ul class="user-list">
        ${(data.users || []).map((user) => `
          <li>
            <span class="store-avatar" aria-hidden="true">${escapeHtml(String(user.name || user.email || 'U').charAt(0).toUpperCase())}</span>
            <div class="row-main"><strong>${escapeHtml(user.name || 'Unnamed user')}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(titleCase(user.role))}</span></div>
            <span class="status-badge ${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Active' : 'Disabled'}</span>
            ${user.is_platform_admin ? '<span class="owner-lock">Platform owner</span>' : `<button class="button ${user.is_active ? 'danger-quiet' : 'secondary'}" type="button" data-user-access="${escapeHtml(user.id)}" data-next-active="${user.is_active ? 'false' : 'true'}" data-user-name="${escapeHtml(user.name || user.email)}">${user.is_active ? 'Disable' : 'Enable'}</button>`}
          </li>
        `).join('')}
      </ul>
    </section>
    <section class="dialog-section" aria-labelledby="store-payments-title">
      <div class="section-heading"><div><span class="section-label">Billing</span><h3 id="store-payments-title">Payment history</h3></div></div>
      ${(data.payments || []).length
        ? `<ul class="data-list payment-list">${data.payments.map((payment) => paymentRow({ ...payment, store_name: store.name }, true)).join('')}</ul>`
        : emptyMarkup('No payment recorded', 'This store has not completed a verified payment.')}
    </section>
  `;
}

async function openStore(storeId) {
  const dialog = document.querySelector('[data-store-dialog]');
  const content = document.querySelector('[data-store-dialog-content]');
  content.innerHTML = loadingMarkup('Loading store account');
  dialog.showModal();
  try {
    const data = await api.get(`/platform/stores/${encodeURIComponent(storeId)}`);
    content.innerHTML = storeDialogMarkup(data);
  } catch (error) {
    content.innerHTML = `<div class="error-state" role="alert"><strong>Could not load store</strong><p>${escapeHtml(error.message)}</p><button class="button secondary" type="button" data-dialog-close>Close</button></div>`;
  }
}

function askForConfirmation({ title, description, confirmLabel, action }) {
  state.pendingConfirmation = action;
  const dialog = document.querySelector('[data-confirm-dialog]');
  dialog.returnValue = '';
  dialog.querySelector('[data-confirm-title]').textContent = title;
  dialog.querySelector('[data-confirm-description]').textContent = description;
  dialog.querySelector('[data-confirm-submit]').textContent = confirmLabel;
  dialog.showModal();
}

function syncInstallButtons() {
  document.querySelectorAll('[data-install]').forEach((button) => {
    button.hidden = !state.installPrompt;
  });
}

async function handleSignIn(form) {
  const errorNode = form.querySelector('[data-form-error]');
  const submit = form.querySelector('button[type="submit"]');
  errorNode.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Checking access…';
  try {
    const values = new FormData(form);
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-QuickPOS-Client': 'website',
      },
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Sign-in failed');
    api.storeSession(body);
    const platform = await api.get('/platform/me');
    state.user = platform.user;
    renderShell();
    await loadCurrentView({ focus: true });
  } catch (error) {
    api.clearSession();
    errorNode.textContent = error.message === 'Platform access required'
      ? 'This account does not have platform access.'
      : error.message;
    form.querySelector('input')?.focus();
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in securely';
  }
}

document.addEventListener('submit', (event) => {
  const signin = event.target.closest('[data-signin-form]');
  if (signin) {
    event.preventDefault();
    handleSignIn(signin);
    return;
  }
  const filter = event.target.closest('[data-filter-form]');
  if (filter) {
    event.preventDefault();
    const values = new FormData(filter);
    state.search = String(values.get('search') || '').trim();
    state.status = String(values.get('status') || 'all');
    state.page = 1;
    syncUrlState();
    loadCurrentView();
  }
});

document.addEventListener('click', async (event) => {
  const passwordToggle = event.target.closest('[data-password-toggle]');
  if (passwordToggle) {
    const passwordInput = document.getElementById(passwordToggle.getAttribute('aria-controls'));
    if (!passwordInput) return;
    const shouldReveal = passwordInput.type === 'password';
    passwordInput.type = shouldReveal ? 'text' : 'password';
    passwordToggle.textContent = shouldReveal ? 'Hide password' : 'Show password';
    passwordToggle.setAttribute('aria-pressed', String(shouldReveal));
    announce(shouldReveal ? 'Password is visible' : 'Password is hidden');
    return;
  }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    await changeView(viewButton.dataset.view);
    return;
  }
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) {
    event.preventDefault();
    await changeView(viewLink.dataset.viewLink);
    return;
  }
  if (event.target.closest('[data-refresh]')) {
    await loadCurrentView();
    return;
  }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton && !pageButton.disabled) {
    state.page = Number(pageButton.dataset.page);
    syncUrlState();
    await loadCurrentView({ focus: true });
    return;
  }
  const storeButton = event.target.closest('[data-store-id]');
  if (storeButton) {
    await openStore(storeButton.dataset.storeId);
    return;
  }
  if (event.target.closest('[data-dialog-close]')) {
    event.target.closest('dialog')?.close();
    return;
  }
  const accessButton = event.target.closest('[data-user-access]');
  if (accessButton) {
    const nextActive = accessButton.dataset.nextActive === 'true';
    const name = accessButton.dataset.userName;
    askForConfirmation({
      title: nextActive ? `Enable ${name}?` : `Disable ${name}?`,
      description: nextActive
        ? 'This person will be able to sign in again using their current credentials.'
        : 'This immediately blocks sign-in and revokes the person’s active refresh sessions. It does not change payment history.',
      confirmLabel: nextActive ? 'Enable access' : 'Disable access',
      action: async () => {
        await api.patch(`/platform/users/${encodeURIComponent(accessButton.dataset.userAccess)}/access`, { is_active: nextActive });
        const storeId = document.querySelector('[data-store-dialog] .section-label')?.textContent.replace(/\D/g, '');
        if (storeId) {
          const data = await api.get(`/platform/stores/${storeId}`);
          document.querySelector('[data-store-dialog-content]').innerHTML = storeDialogMarkup(data);
        }
        announce(`${name} access ${nextActive ? 'enabled' : 'disabled'}`);
      },
    });
    return;
  }
  if (event.target.closest('[data-signout]')) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-QuickPOS-Client': 'website' },
        body: '{}',
      });
    } catch { /* Local sign-out must still complete. */ }
    api.clearSession();
    state.user = null;
    renderSignIn();
    return;
  }
  if (event.target.closest('[data-install]') && state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    syncInstallButtons();
  }
});

document.addEventListener('close', async (event) => {
  if (!event.target.matches('[data-confirm-dialog]')) return;
  const action = state.pendingConfirmation;
  state.pendingConfirmation = null;
  if (event.target.returnValue !== 'confirm' || !action) return;
  const submit = event.target.querySelector('[data-confirm-submit]');
  try {
    submit.disabled = true;
    await action();
    if (state.view !== 'overview') await loadCurrentView();
  } catch (error) {
    announce(`Change failed: ${error.message}`);
    window.alert(`The change could not be completed. ${error.message}`);
  } finally {
    submit.disabled = false;
  }
}, true);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  syncInstallButtons();
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  syncInstallButtons();
  announce('QP Control installed');
});

async function bootstrap() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
  }
  const hashView = window.location.hash.replace('#', '');
  if (views.includes(hashView)) state.view = hashView;
  if (state.view !== 'overview') {
    const params = new URLSearchParams(window.location.search);
    state.search = params.get('search') || '';
    state.status = params.get('status') || 'all';
    state.page = Math.max(1, Number(params.get('page') || 1));
  }
  if (!api.accessToken) {
    renderSignIn();
    return;
  }
  try {
    const platform = await api.get('/platform/me');
    state.user = platform.user;
    renderShell();
    await loadCurrentView();
  } catch (error) {
    api.clearSession();
    renderSignIn(error.status === 403
      ? 'This account does not have platform access.'
      : 'Your private session has ended. Sign in again.');
  }
}

bootstrap();
