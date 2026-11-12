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
const views = ['overview', 'inbox', 'stores', 'payments', 'activity', 'announcements', 'team', 'system'];

const icons = {
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  stores: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5 5 4h14l2 5.5M5 13v7h14v-7M9 20v-5h6v5"/><path d="M3 9.5c0 1.4 1 2.5 2.3 2.5S7.7 11 8 9.5C8.3 11 9.4 12 10.7 12s2.3-1 2.6-2.5c.3 1.5 1.4 2.5 2.7 2.5s2.3-1 2.6-2.5c.3 1.5 1.3 2.5 2.4 2.5"/></svg>',
  payments: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  install: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.7-2L20 12M4 12l2.2 5a7 7 0 0 0 11.7-2"/></svg>',
  activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 13h8M8 17h5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>',
  announcements: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l6 4V6L7 10H4z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  team: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>',
  system: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
};

const state = {
  view: 'overview',
  user: null,
  overview: null,
  payments: null,
  trends: null,
  activity: null,
  currentStoreId: null,
  attention: null,
  inboxStatus: 'open',
  currentConversationId: null,
  thread: null,
  threadTimer: null,
  summaryTimer: null,
  inboxUnread: 0,
  confirmNeedsReason: false,
  lastStartedConversation: null,
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

const STATUS_LABELS = {
  grandfathered: 'Permanent access',
  pending_activation: 'Awaiting activation',
  past_due: 'Payment overdue',
  paid_duplicate: 'Duplicate payment',
  initialized: 'Checkout started',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || titleCase(status);
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
      error.code = body.code;
      throw error;
    }
    return body;
  }

  get(path) { return this.request(path); }
  patch(path, body) { return this.request(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); }
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
        <span class="section-label">QP Control</span>
        <h2 class="context-title">Every QuickPOS store in one private workspace.</h2>
        <dl class="context-list">
          <div><span class="context-icon" aria-hidden="true">${icons.stores}</span><dt>Registrations</dt><dd>See store owners as soon as they create an account.</dd></div>
          <div><span class="context-icon" aria-hidden="true">${icons.payments}</span><dt>Payments</dt><dd>Tell verified payments apart from checkout attempts.</dd></div>
          <div><span class="context-icon" aria-hidden="true">${icons.activity}</span><dt>Growth</dt><dd>Track sign-ups, paid conversions and revenue month by month.</dd></div>
          <div><span class="context-icon" aria-hidden="true">${icons.lock}</span><dt>Access and support</dt><dd>Disable a sign-in, extend access, resend emails and keep notes, with every action logged.</dd></div>
        </dl>
      </aside>
    </main>
  `;
  document.getElementById('main-content')?.focus();
}

function navButton(view, label) {
  return `
    <button type="button" class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>
      ${icons[view]}<span>${label}</span>${view === 'inbox' ? '<span class="nav-badge" data-inbox-badge hidden>0</span>' : ''}
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
          ${navButton('inbox', 'Inbox')}
          ${navButton('stores', 'Stores')}
          ${navButton('payments', 'Payments')}
          ${navButton('activity', 'Activity')}
          ${navButton('announcements', 'Announcements')}
          ${navButton('team', 'Team')}
          ${navButton('system', 'System')}
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
            <button type="button" class="search-trigger" data-open-search aria-keyshortcuts="/" aria-label="Search stores, people and payments">${icons.search}<span>Search</span><kbd aria-hidden="true">/</kbd></button>
            <button type="button" class="icon-button" data-refresh aria-label="Refresh current data" title="Refresh">${icons.refresh}</button>
            <span class="connection-state"><i aria-hidden="true"></i>Live</span>
          </div>
        </header>
        <main class="main-content" id="main-content" tabindex="-1"></main>
      </div>
      <nav class="bottom-nav" aria-label="Primary navigation">
        ${navButton('overview', 'Overview')}
        ${navButton('inbox', 'Inbox')}
        ${navButton('stores', 'Stores')}
        ${navButton('payments', 'Payments')}
        <button type="button" class="nav-item ${MORE_VIEWS.includes(state.view) ? 'active' : ''}" data-open-more aria-haspopup="dialog">${icons.more}<span>More</span></button>
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
        <div class="confirm-reason" data-confirm-reason hidden>
          <label for="confirm-reason-input" data-confirm-reason-label>Reason</label>
          <input id="confirm-reason-input" type="text" maxlength="300" autocomplete="off">
          <p class="form-error" role="alert" data-confirm-reason-error></p>
        </div>
        <div class="dialog-actions">
          <button class="button secondary" value="cancel">Cancel</button>
          <button class="button danger" value="confirm" data-confirm-submit>Confirm</button>
        </div>
      </form>
    </dialog>
    ${moreMenuMarkup()}
  `;
  syncInstallButtons();
  syncInboxBadges();
  startBackgroundPolling();
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
      ${payment.id && payment.status === 'initialized' && ['paystack', 'flutterwave'].includes(payment.provider) ? `<button class="button secondary payment-check" type="button" data-verify-payment="${escapeHtml(payment.id)}">Check with ${payment.provider === 'paystack' ? 'Paystack' : 'Flutterwave'}</button>` : ''}
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

function monthName(month, style = 'short') {
  const [year, monthIndex] = String(month).split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: style, ...(style === 'long' ? { year: 'numeric' } : {}), timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

function revenueIn(entry, currency) {
  return Number(entry.revenue?.find((item) => item.currency === currency)?.amount || 0);
}

function changeText(current, previous, previousMonth, format = (value) => String(value)) {
  const diff = current - previous;
  if (diff === 0) return `Same as ${monthName(previousMonth, 'long')}`;
  return `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))} vs ${monthName(previousMonth, 'long')}`;
}

function trendBars(months, valueOf, label, format) {
  const values = months.map(valueOf);
  const max = Math.max(...values, 1);
  const width = 240;
  const height = 64;
  const slot = width / values.length;
  const peakIndex = values.indexOf(Math.max(...values));
  const bars = values.map((value, index) => {
    const barHeight = value > 0 ? Math.max(3, Math.round((value / max) * (height - 4))) : 2;
    const current = index === values.length - 1;
    return `<rect x="${(index * slot + 2).toFixed(1)}" y="${height - barHeight}" width="${(slot - 4).toFixed(1)}" height="${barHeight}" rx="2" class="${current ? 'current' : ''}${value === 0 ? ' zero' : ''}"><title>${escapeHtml(monthName(months[index].month, 'long'))}: ${escapeHtml(format(value))}</title></rect>`;
  }).join('');
  const summary = values.some((value) => value > 0)
    ? `${label} per month for the last ${values.length} months. Highest: ${format(values[peakIndex])} in ${monthName(months[peakIndex].month, 'long')}.`
    : `${label} per month for the last ${values.length} months. None yet.`;
  return `<svg class="trend-bars" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(summary)}">${bars}</svg>`;
}

function trendsMarkup(trends) {
  const months = trends?.months || [];
  if (months.length < 2) return '';
  const current = months[months.length - 1];
  const previous = months[months.length - 2];
  const naira = (value) => formatMoney(value, 'NGN');
  const otherCurrencies = [...new Set(months.flatMap((entry) => (entry.revenue || []).map((item) => item.currency)))].filter((code) => code !== 'NGN');
  const otherTotals = otherCurrencies.map((code) => formatMoney(months.reduce((sum, entry) => sum + revenueIn(entry, code), 0), code));
  const cards = [
    { title: 'Sign-ups', value: (entry) => entry.signups, format: (value) => String(value), unit: (value) => (value === 1 ? 'new store' : 'new stores') },
    { title: 'First payments', value: (entry) => entry.first_payments, format: (value) => String(value), unit: (value) => (value === 1 ? 'store paid' : 'stores paid') },
    { title: 'Revenue (NGN)', value: (entry) => revenueIn(entry, 'NGN'), format: naira, unit: () => 'verified' },
  ];
  return `
    <section class="data-section trends" aria-labelledby="trends-title">
      <div class="section-heading"><div><span class="section-label">Last ${months.length} months</span><h2 id="trends-title">Growth</h2></div></div>
      <div class="trend-grid">
        ${cards.map((card) => `
          <article class="trend-card">
            <h3>${escapeHtml(card.title)}</h3>
            <p class="trend-value">${escapeHtml(card.format(card.value(current)))} <span>${escapeHtml(card.unit(card.value(current)))} this month</span></p>
            <p class="trend-change">${escapeHtml(changeText(card.value(current), card.value(previous), previous.month, card.format))}</p>
            ${trendBars(months, card.value, card.title, card.format)}
            <div class="trend-axis" aria-hidden="true"><span>${escapeHtml(monthName(months[0].month))}</span><span>${escapeHtml(monthName(current.month))}</span></div>
          </article>`).join('')}
      </div>
      ${otherTotals.length ? `<p class="trend-note">Also verified in the same period: ${escapeHtml(otherTotals.join(' · '))}.</p>` : ''}
      <details class="trend-table">
        <summary>Show as a table</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th scope="col">Month</th><th scope="col">Sign-ups</th><th scope="col">First payments</th><th scope="col">Revenue</th></tr></thead>
            <tbody>
              ${months.slice().reverse().map((entry) => `<tr><th scope="row">${escapeHtml(monthName(entry.month, 'long'))}</th><td>${escapeHtml(entry.signups)}</td><td>${escapeHtml(entry.first_payments)}</td><td>${escapeHtml((entry.revenue || []).length ? entry.revenue.map((item) => formatMoney(item.amount, item.currency)).join(' · ') : '—')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  `;
}

function csvCell(value) {
  if (value == null) return '';
  let text = String(value);
  // Stop spreadsheet apps from running text that starts like a formula.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}

function downloadCsv(filename, header, rows) {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCurrentList(kind, button) {
  const params = new URLSearchParams({ search: state.search, status: state.status });
  const today = new Date().toISOString().slice(0, 10);
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    if (kind === 'stores') {
      const data = await api.get(`/platform/export/stores?${params}`);
      downloadCsv(`quickpos-stores-${today}.csv`,
        ['Store ID', 'Store', 'Store email', 'Owner', 'Owner email', 'Owner sign-in', 'Registered', 'Subscription', 'Plan', 'Paid through', 'Activation paid', 'Last payment', 'Currency', 'Last payment date'],
        (data.stores || []).map((store) => [
          store.id, store.name, store.email, store.owner_name, store.owner_email,
          store.owner_is_active === false ? 'Disabled' : 'Active', csvDate(store.created_at),
          store.subscription_status, store.plan_code, csvDate(store.current_period_end),
          store.activation_fee_paid ? 'Yes' : 'No', store.payment_amount, store.payment_currency, csvDate(store.payment_paid_at),
        ]));
      announce(data.truncated ? 'Exported the first 5,000 stores' : `Exported ${(data.stores || []).length} stores`);
    } else {
      const data = await api.get(`/platform/export/payments?${params}`);
      downloadCsv(`quickpos-payments-${today}.csv`,
        ['Payment ID', 'Store ID', 'Store', 'Store email', 'Provider', 'Reference', 'Transaction ID', 'Plan', 'Amount', 'Currency', 'Status', 'Paid at', 'Created at'],
        (data.payments || []).map((payment) => [
          payment.id, payment.store_id, payment.store_name, payment.store_email, payment.provider,
          payment.provider_reference, payment.provider_transaction_id, payment.plan_code,
          payment.amount, payment.currency, payment.status, csvDate(payment.paid_at), csvDate(payment.created_at),
        ]));
      announce(data.truncated ? 'Exported the first 5,000 payments' : `Exported ${(data.payments || []).length} payments`);
    }
  } catch (error) {
    announce(`Export failed: ${error.message}`);
    window.alert(`The export could not be prepared. ${error.message}`);
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

const MORE_VIEWS = ['activity', 'announcements', 'team', 'system'];

const ACTIVITY_ICONS = {
  user_access_changed: 'lock',
  subscription_extended: 'calendar',
  store_note_added: 'note',
  email_resent: 'mail',
  manual_payment_recorded: 'payments',
  payment_checked: 'payments',
  permanent_access_granted: 'calendar',
  permanent_access_removed: 'calendar',
  store_suspended: 'lock',
  store_restored: 'lock',
  password_reset_sent: 'mail',
  announcement_published: 'announcements',
  announcement_ended: 'announcements',
  platform_admin_granted: 'team',
  platform_admin_removed: 'team',
};

function activityText(entry) {
  const who = entry.actor_name || entry.actor_email || 'A platform admin';
  const store = entry.store_name || (entry.store_id ? `store #${entry.store_id}` : 'a store');
  const values = entry.new_values || {};
  if (entry.action === 'user_access_changed') {
    const person = entry.target_user_name || entry.target_user_email || 'a user';
    return `${who} ${values.is_active ? 'enabled' : 'disabled'} sign-in for ${person} at ${store}`;
  }
  if (entry.action === 'subscription_extended') {
    return `${who} extended ${store} by ${values.days} day${Number(values.days) === 1 ? '' : 's'}, to ${formatDate(values.current_period_end)}`;
  }
  if (entry.action === 'store_note_added') return `${who} added a note to ${store}`;
  if (entry.action === 'email_resent') {
    return `${who} resent the ${values.type === 'welcome' ? 'welcome email' : 'activation reminder'} to ${store}`;
  }
  if (entry.action === 'manual_payment_recorded') {
    return `${who} recorded a ${formatMoney(values.amount, values.currency)} ${values.plan_name || titleCase(values.plan_code)} payment for ${store}`;
  }
  if (entry.action === 'permanent_access_granted') return `${who} gave ${store} permanent access`;
  if (entry.action === 'permanent_access_removed') return `${who} removed permanent access from ${store}`;
  if (entry.action === 'store_suspended') return `${who} suspended ${store}`;
  if (entry.action === 'store_restored') return `${who} restored ${store}`;
  if (entry.action === 'password_reset_sent') {
    return `${who} sent a password reset link to ${entry.target_user_name || entry.target_user_email || 'a user'} at ${store}`;
  }
  if (entry.action === 'payment_checked') {
    return `${who} checked ${titleCase(values.provider)} payment ${values.reference} for ${store}: ${titleCase(values.status)}`;
  }
  if (entry.action === 'announcement_published') return `${who} published the announcement “${values.title}”`;
  if (entry.action === 'announcement_ended') return `${who} ended the announcement “${values.title}”`;
  if (entry.action === 'platform_admin_granted') {
    return `${who} made ${entry.target_user_name || values.email || 'someone'} a platform admin`;
  }
  if (entry.action === 'platform_admin_removed') {
    return `${who} removed ${entry.target_user_name || entry.target_user_email || 'someone'} from the platform admins`;
  }
  return `${who}: ${titleCase(entry.action)} (${store})`;
}

function activityDetail(entry) {
  const values = entry.new_values || {};
  if (entry.action === 'manual_payment_recorded') {
    return `Reference ${values.reference}${values.note ? ` · ${values.note}` : ''} · access to ${formatDate(values.current_period_end)}`;
  }
  if (values.reason) return `Reason: ${values.reason}`;
  if (entry.action === 'store_note_added' && values.note) return values.note;
  return '';
}

function activityRow(entry, { showStore = true } = {}) {
  const detail = activityDetail(entry);
  return `
    <li class="activity-row">
      <span class="activity-icon" aria-hidden="true">${icons[ACTIVITY_ICONS[entry.action] || 'activity']}</span>
      <div class="row-main">
        <strong>${escapeHtml(activityText(entry))}</strong>
        ${detail ? `<p class="activity-detail">${escapeHtml(detail)}</p>` : ''}
        <span>${escapeHtml(formatDate(entry.created_at, true))}</span>
      </div>
      ${showStore && entry.store_id ? `<button class="button secondary activity-open" type="button" data-store-id="${escapeHtml(entry.store_id)}" aria-label="Open ${escapeHtml(entry.store_name || `store #${entry.store_id}`)}">Open store</button>` : ''}
    </li>
  `;
}

function activityMarkup(data) {
  return `
    <section class="page-intro"><div><span class="section-label">Audit trail</span><h2>Activity</h2></div><p>Every change made from QP Control: sign-in access, access extensions, resent emails and notes. Entries cannot be edited or removed.</p></section>
    <section class="data-section data-section-full" aria-label="Admin activity">
      ${(data.activity || []).length
        ? `<ul class="data-list activity-list">${data.activity.map((entry) => activityRow(entry)).join('')}</ul>`
        : emptyMarkup('No admin activity yet', 'Changes made from QP Control will be listed here.')}
      ${paginationMarkup(data.pagination)}
    </section>
  `;
}

function overviewMarkup(data) {
  const summary = data.summary || {};
  const registered = Number(summary.registered_stores || 0);
  const conversion = registered ? Math.round((Number(summary.paid_stores || 0) / registered) * 100) : 0;
  return `
    <section class="dashboard-intro" aria-labelledby="dashboard-heading">
      <div><span class="section-label">Today’s control room</span><h2 id="dashboard-heading">Know who joined and who paid.</h2></div>
      <p>Payment totals only include provider-confirmed transactions. An attempted checkout does not count as paid.</p>
    </section>
    <dl class="metrics" aria-label="Account summary">
      <div><dt>Registered stores</dt><dd>${escapeHtml(summary.registered_stores || 0)}</dd><span>${escapeHtml(summary.registered_last_7_days || 0)} in the last 7 days</span></div>
      <div><dt>Stores with payment</dt><dd>${escapeHtml(summary.paid_stores || 0)}</dd><span>${escapeHtml(conversion)}% of registered stores have paid</span></div>
      <div><dt>Awaiting payment</dt><dd>${escapeHtml(summary.pending_stores || 0)}</dd><span>Registered without a verified payment</span></div>
      <div class="metric-wide"><dt>Verified revenue</dt><dd>${escapeHtml(totalsMarkup(summary.payment_totals))}</dd><span>${escapeHtml((summary.payment_totals || []).reduce((sum, item) => sum + Number(item.count || 0), 0))} successful transactions</span></div>
    </dl>
    ${attentionMarkup(state.attention)}
    ${trendsMarkup(state.trends)}
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
      <button class="button secondary filter-export" type="button" data-export="${kind}">${icons.download}<span>Export CSV</span></button>
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
  const titles = { overview: 'Overview', inbox: 'Inbox', stores: 'Stores', payments: 'Payments', activity: 'Activity', announcements: 'Announcements', team: 'Team', system: 'System' };
  document.querySelectorAll('[data-open-more]').forEach((button) => button.classList.toggle('active', MORE_VIEWS.includes(state.view)));
  const title = document.querySelector('[data-page-title]');
  if (title) title.textContent = titles[state.view];
  document.title = `${titles[state.view]} · QP Control`;
}

function syncUrlState() {
  const params = new URLSearchParams();
  if (state.view !== 'overview') {
    if (state.search && state.view !== 'activity') params.set('search', state.search);
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
      const optional = (request) => request.catch((error) => {
        if (error.status === 401 || error.status === 403) throw error;
        return null;
      });
      const [data, trends, attention] = await Promise.all([
        api.get('/platform/overview?limit=10'),
        optional(api.get('/platform/trends?months=12')),
        optional(api.get('/platform/attention')),
      ]);
      state.overview = data;
      state.trends = trends;
      state.attention = attention;
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
    } else if (state.view === 'inbox') {
      const params = new URLSearchParams({ status: state.inboxStatus, page: String(state.page) });
      const data = await api.get(`/platform/inbox?${params}`);
      content.innerHTML = inboxMarkup(data);
      if (state.currentConversationId) loadThread({ initial: true }).then(startThreadPolling);
    } else if (state.view === 'announcements') {
      content.innerHTML = announcementsMarkup(await api.get('/platform/announcements'));
    } else if (state.view === 'team') {
      content.innerHTML = teamMarkup(await api.get('/platform/admins'));
    } else if (state.view === 'system') {
      content.innerHTML = systemMarkup(await api.get('/platform/system'));
    } else if (state.view === 'activity') {
      const params = new URLSearchParams({ page: String(state.page), limit: '20' });
      const data = await api.get(`/platform/activity?${params}`);
      state.activity = data;
      content.innerHTML = activityMarkup(data);
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
      stopAllPolling();
      api.clearSession();
      renderSignIn(error.status === 403 ? 'This account does not have platform access.' : 'Your session has ended. Sign in again.');
      return;
    }
    if (error.code === 'MIGRATION_REQUIRED') {
      content.innerHTML = migrationMarkup(state.view === 'inbox' ? 'Live chat' : 'Announcements');
      return;
    }
    content.innerHTML = `<div class="error-state" role="alert"><strong>Could not load current data</strong><p>${escapeHtml(error.message)}</p><button class="button secondary" type="button" data-refresh>Try again</button></div>`;
  } finally {
    state.loading = false;
  }
}

async function changeView(view) {
  if (!views.includes(view) || state.loading) return;
  closeOverlays();
  if (view !== 'inbox') {
    state.currentConversationId = null;
    stopThreadPolling();
  }
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
      <div><span>Subscription</span><strong>${escapeHtml(statusLabel(store.subscription_status))}</strong></div>
      <div><span>Plan</span><strong>${escapeHtml(titleCase(store.plan_code || 'Not selected'))}</strong></div>
      <div><span>Paid through</span><strong>${escapeHtml(formatDate(store.current_period_end))}</strong></div>
    </div>
    ${usageMarkup(data.usage, store.currency)}
    ${storeActionsMarkup(store, data)}
    <section class="dialog-section" aria-labelledby="store-users-title">
      <div class="section-heading"><div><span class="section-label">People</span><h3 id="store-users-title">Store accounts</h3></div></div>
      <ul class="user-list">
        ${(data.users || []).map((user) => `
          <li>
            <span class="store-avatar" aria-hidden="true">${escapeHtml(String(user.name || user.email || 'U').charAt(0).toUpperCase())}</span>
            <div class="row-main"><strong>${escapeHtml(user.name || 'Unnamed user')}</strong><span>${escapeHtml(user.email)} · ${escapeHtml(titleCase(user.role))}</span></div>
            <span class="status-badge ${user.is_active ? 'success' : 'danger'}">${user.is_active ? 'Active' : 'Disabled'}</span>
            ${user.is_platform_admin ? '<span class="owner-lock">Platform owner</span>' : `<div class="user-actions">${user.is_active ? `<button class="button secondary" type="button" data-password-reset="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name || user.email)}" data-user-email="${escapeHtml(user.email)}">Send reset link</button>` : ''}<button class="button ${user.is_active ? 'danger-quiet' : 'secondary'}" type="button" data-user-access="${escapeHtml(user.id)}" data-next-active="${user.is_active ? 'false' : 'true'}" data-user-name="${escapeHtml(user.name || user.email)}">${user.is_active ? 'Disable' : 'Enable'}</button></div>`}
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
    <section class="dialog-section" aria-labelledby="store-notes-title">
      <div class="section-heading"><div><span class="section-label">Private to platform admins</span><h3 id="store-notes-title">Notes</h3></div></div>
      <form class="note-form" data-note-form novalidate>
        <label for="store-note">Add a note</label>
        <textarea id="store-note" name="note" rows="3" maxlength="1000" placeholder="What happened, what was agreed, what to follow up on"></textarea>
        <p class="form-error" role="alert" data-note-error></p>
        <button class="button secondary" type="submit">Save note</button>
      </form>
      ${(data.notes || []).length
        ? `<ul class="note-list">${data.notes.map((note) => `<li><p>${escapeHtml(note.new_values?.note || '')}</p><span>${escapeHtml(note.actor_name || note.actor_email || 'Platform admin')} · ${escapeHtml(formatDate(note.created_at, true))}</span></li>`).join('')}</ul>`
        : '<p class="muted-line">No notes yet.</p>'}
    </section>
    ${(data.activity || []).length ? `
      <section class="dialog-section" aria-labelledby="store-activity-title">
        <div class="section-heading"><div><span class="section-label">Audit trail</span><h3 id="store-activity-title">Recent admin activity</h3></div></div>
        <ul class="data-list activity-list">${data.activity.map((entry) => activityRow(entry, { showStore: false })).join('')}</ul>
      </section>` : ''}
  `;
}

function storeActionsMarkup(store, data = {}) {
  const permanent = store.subscription_status === 'grandfathered';
  const canRemind = !store.activation_fee_paid && !permanent;
  return `
    <section class="dialog-section" aria-labelledby="store-actions-title">
      <div class="section-heading"><div><span class="section-label">Support</span><h3 id="store-actions-title">Account actions</h3></div></div>
      <p class="action-status" role="status" tabindex="-1" data-action-status></p>
      <div class="action-grid">
        ${permanent
          ? `<div class="action-card"><h4>${icons.calendar}Access</h4><p>This store has permanent access, so it cannot be extended.</p></div>`
          : `<form class="action-card" data-extend-form novalidate>
              <h4>${icons.calendar}Extend access</h4>
              <p>Adds free days to the paid-through date. It does not mark the activation fee as paid, and it is logged.</p>
              <label for="extend-days">Days to add</label>
              <select id="extend-days" name="days">
                ${[7, 14, 30, 60, 90].map((days) => `<option value="${days}" ${days === 30 ? 'selected' : ''}>${days} days</option>`).join('')}
              </select>
              <label for="extend-reason">Reason</label>
              <input id="extend-reason" name="reason" type="text" maxlength="300" autocomplete="off" placeholder="e.g. Setup took longer than planned">
              <p class="form-error" role="alert" data-extend-error></p>
              <button class="button primary" type="submit">Extend access</button>
            </form>`}
        <div class="action-card">
          <h4>${icons.mail}Resend emails</h4>
          <p>Sends to ${escapeHtml(store.email || 'the store owner')}. Each email can be resent once an hour.</p>
          <div class="action-buttons">
            <button class="button secondary" type="button" data-resend-email="welcome">Resend welcome email</button>
            ${canRemind ? '<button class="button secondary" type="button" data-resend-email="activation_reminder">Send activation reminder</button>' : ''}
          </div>
        </div>
        ${moreStoreActionsMarkup(store, data)}
      </div>
    </section>
  `;
}

async function fetchStoreDetail(storeId) {
  const id = encodeURIComponent(storeId);
  const [data, usage] = await Promise.all([
    api.get(`/platform/stores/${id}`),
    api.get(`/platform/stores/${id}/usage`).catch(() => null),
  ]);
  return { ...data, usage: usage?.usage || null };
}

function closeOverlays() {
  document.querySelectorAll('[data-search-dialog], [data-more-dialog]').forEach((dialog) => {
    if (dialog.open) dialog.close();
  });
}

async function reloadStoreDialog({ message = '', focus = '' } = {}) {
  if (!state.currentStoreId) return;
  const content = document.querySelector('[data-store-dialog-content]');
  const data = await fetchStoreDetail(state.currentStoreId);
  content.innerHTML = storeDialogMarkup(data);
  if (message) {
    const status = content.querySelector('[data-action-status]');
    if (status) status.textContent = message;
    announce(message);
  }
  if (focus) content.querySelector(focus)?.focus();
}

async function handleNoteSubmit(form) {
  const error = form.querySelector('[data-note-error]');
  const submit = form.querySelector('button[type="submit"]');
  const note = String(new FormData(form).get('note') || '').trim();
  error.textContent = '';
  if (!note) {
    error.textContent = 'Write a note first.';
    form.querySelector('textarea')?.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Saving…';
  try {
    await api.post(`/platform/stores/${encodeURIComponent(state.currentStoreId)}/notes`, { note });
    await reloadStoreDialog({ focus: '#store-note' });
    announce('Note saved');
  } catch (requestError) {
    error.textContent = requestError.message;
    submit.disabled = false;
    submit.textContent = 'Save note';
  }
}

function handleExtendSubmit(form) {
  const error = form.querySelector('[data-extend-error]');
  const values = new FormData(form);
  const days = Number(values.get('days'));
  const reason = String(values.get('reason') || '').trim();
  error.textContent = '';
  if (reason.length < 3) {
    error.textContent = 'Give a short reason. It is saved in the activity log.';
    form.querySelector('#extend-reason')?.focus();
    return;
  }
  const storeName = document.getElementById('store-dialog-title')?.textContent || 'this store';
  const storeId = state.currentStoreId;
  askForConfirmation({
    title: `Extend ${storeName} by ${days} days?`,
    description: 'The store gets full access for these extra days, starting from today or its current paid-through date, whichever is later. The activation fee stays unpaid.',
    confirmLabel: 'Extend access',
    tone: 'primary',
    action: async () => {
      const result = await api.post(`/platform/stores/${encodeURIComponent(storeId)}/extend`, { days, reason });
      await reloadStoreDialog({ message: `Access extended to ${formatDate(result.subscription?.current_period_end)}.`, focus: '[data-action-status]' });
    },
  });
}

async function handleResendEmail(button) {
  const status = document.querySelector('[data-action-status]');
  const type = button.dataset.resendEmail;
  const label = type === 'welcome' ? 'Welcome email' : 'Activation reminder';
  button.disabled = true;
  if (status) status.textContent = 'Sending…';
  try {
    await api.post(`/platform/stores/${encodeURIComponent(state.currentStoreId)}/emails`, { type });
    await reloadStoreDialog({ message: `${label} sent.`, focus: '[data-action-status]' });
  } catch (error) {
    if (status) status.textContent = error.message;
    announce(error.message);
    button.disabled = false;
  }
}

// ---- Admin tools: inbox, follow-ups, store controls, announcements, team, system ----

const PLAN_OPTIONS = [
  { code: 'activation_5m', label: 'Initial activation (5 months)', NGN: 20000, USD: 15 },
  { code: 'monthly', label: 'Monthly renewal', NGN: 5000, USD: 4 },
  { code: 'quarterly', label: 'Quarterly renewal', NGN: 13500, USD: 10 },
  { code: 'yearly', label: 'Yearly renewal', NGN: 50000, USD: 38 },
];

const QUICK_REPLIES = [
  'Thanks for reaching out. I am looking into this now.',
  'Your payment is confirmed and your store is active.',
  'Could you send a screenshot of what you see?',
  'Please sign out and sign in again, then let me know if it still happens.',
  'Is there anything else I can help with?',
];

const ATTENTION_LISTS = [
  ['unanswered_chats', 'Chats waiting for a reply', 'The store wrote last and nobody has answered.'],
  ['renewals_due', 'Renewals due in 7 days', 'A reminder now avoids a lapse.'],
  ['recently_expired', 'Expired in the last 30 days', 'Paid stores whose access ran out.'],
  ['unpaid_signups', 'Signed up, not activated', 'Registered at least 2 days ago without paying.'],
  ['quiet_paid_stores', 'Paid stores with no sales', 'No sale recorded in the last 14 days.'],
  ['stuck_payments', 'Checkouts not completed', 'Started over an hour ago and never confirmed.'],
];

function migrationMarkup(feature) {
  return `<div class="empty-state migration-state" role="status"><strong>${escapeHtml(feature)} needs a database update</strong><p>Run the latest database update for the QuickPOS server (npm run db:migrate), then refresh this page. Nothing else needs to change.</p><button class="button secondary" type="button" data-refresh>Refresh</button></div>`;
}

function attentionDetail(key, item) {
  if (key === 'renewals_due') return `Renews ${formatDate(item.date)}`;
  if (key === 'recently_expired') return `Expired ${formatDate(item.date)}`;
  if (key === 'unpaid_signups') return `Registered ${formatDate(item.date)}`;
  if (key === 'quiet_paid_stores') return item.date ? `Last sale ${formatDate(item.date)}` : 'No sales yet';
  if (key === 'stuck_payments') return `${item.detail || 'Checkout'} · ${formatDate(item.date, true)}`;
  if (key === 'unanswered_chats') return item.detail || 'New message';
  return formatDate(item.date);
}

function attentionMarkup(attention) {
  if (!attention) return '';
  const cards = ATTENTION_LISTS.filter(([key]) => attention[key] && attention[key].available !== false);
  if (!cards.length) return '';
  const total = cards.reduce((sum, [key]) => sum + Number(attention[key].count || 0), 0);
  return `
    <section class="data-section" aria-labelledby="attention-title">
      <div class="section-heading"><div><span class="section-label">Follow up</span><h2 id="attention-title">Needs attention</h2></div><span class="attention-total">${escapeHtml(total)} item${total === 1 ? '' : 's'}</span></div>
      <div class="attention-grid">
        ${cards.map(([key, title, hint]) => {
          const list = attention[key];
          return `
            <article class="attention-card ${list.count ? '' : 'clear'}">
              <header><h3>${escapeHtml(title)}</h3><span class="attention-count">${escapeHtml(list.count)}</span></header>
              <p>${escapeHtml(hint)}</p>
              ${list.items.length
                ? `<ul>${list.items.map((item) => `<li><button type="button" class="attention-item" ${key === 'unanswered_chats' && item.conversation_id ? `data-open-conversation="${escapeHtml(item.conversation_id)}"` : `data-store-id="${escapeHtml(item.store_id)}"`}><strong>${escapeHtml(item.store_name || `Store #${item.store_id}`)}</strong><span>${escapeHtml(attentionDetail(key, item))}</span></button></li>`).join('')}</ul>
                   ${list.count > list.items.length ? `<p class="muted-line">and ${escapeHtml(list.count - list.items.length)} more</p>` : ''}`
                : '<p class="muted-line">Nothing here right now.</p>'}
            </article>`;
        }).join('')}
      </div>
    </section>
  `;
}

// Inbox
function shortWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(undefined, today ? { timeStyle: 'short' } : { day: 'numeric', month: 'short' }).format(date);
}

function conversationRow(conversation) {
  const active = Number(state.currentConversationId) === conversation.id;
  return `
    <li>
      <button type="button" class="conversation-row ${conversation.unread ? 'unread' : ''} ${active ? 'active' : ''}" data-conversation-id="${escapeHtml(conversation.id)}" ${active ? 'aria-current="true"' : ''}>
        <span class="store-avatar" aria-hidden="true">${escapeHtml(String(conversation.store_name || 'S').charAt(0).toUpperCase())}</span>
        <span class="row-main">
          <strong>${escapeHtml(conversation.store_name || 'Store')}</strong>
          <span>${escapeHtml(conversation.last_sender === 'admin' ? `You: ${conversation.last_message_preview || ''}` : conversation.last_message_preview || 'No messages yet')}</span>
        </span>
        <span class="conversation-meta">
          <small>${escapeHtml(shortWhen(conversation.last_message_at))}</small>
          ${conversation.unread ? '<span class="status-badge warning">New</span>' : conversation.status === 'closed' ? '<span class="status-badge">Closed</span>' : ''}
        </span>
      </button>
    </li>
  `;
}

function inboxListMarkup(data) {
  return `${(data.conversations || []).length
    ? `<ul class="conversation-list">${data.conversations.map(conversationRow).join('')}</ul>`
    : emptyMarkup(state.inboxStatus === 'open' ? 'No open chats' : 'No chats here', 'When a store uses Chat with support in the POS app, the conversation appears here.')}
    ${Number(data.pagination?.total || 0) > Number(data.pagination?.limit || 25) ? paginationMarkup(data.pagination) : ''}`;
}

function inboxMarkup(data) {
  const filters = [['open', 'Open'], ['closed', 'Closed'], ['all', 'All']];
  return `
    <section class="page-intro"><div><span class="section-label">Live chat</span><h2>Inbox</h2></div><p>Messages from stores using Chat with support in the POS app. While a chat is open here, new messages arrive every few seconds.</p></section>
    <div class="inbox-filters" role="group" aria-label="Show chats">
      ${filters.map(([value, label]) => `<button type="button" class="chip-button" data-inbox-status="${value}" aria-pressed="${state.inboxStatus === value}">${label}</button>`).join('')}
    </div>
    <div class="inbox-layout ${state.currentConversationId ? 'has-thread' : ''}" data-inbox-layout>
      <section class="inbox-list" aria-label="Conversations" data-inbox-list>${inboxListMarkup(data)}</section>
      <section class="inbox-thread" aria-label="Conversation" data-inbox-thread>
        ${state.currentConversationId ? loadingMarkup('Loading conversation') : '<div class="empty-state"><strong>Choose a conversation</strong><p>Select a chat to read it and reply.</p></div>'}
      </section>
    </div>
  `;
}

function threadMessageMarkup(message) {
  if (message.sender_type === 'system') {
    return `<li class="thread-system" data-message-id="${escapeHtml(message.id)}">${escapeHtml(message.body)}</li>`;
  }
  const mine = message.sender_type === 'admin';
  return `
    <li class="thread-message ${mine ? 'mine' : 'theirs'}" data-message-id="${escapeHtml(message.id)}">
      <div class="thread-bubble">${escapeHtml(message.body)}</div>
      <span>${escapeHtml(message.sender_name || (mine ? 'QuickPOS support' : 'Store'))} · ${escapeHtml(formatDate(message.created_at, true))}</span>
    </li>
  `;
}

function threadMarkup(conversation, messages) {
  const open = conversation.status === 'open';
  const owner = [conversation.owner_name, conversation.owner_email || conversation.store_email, conversation.owner_phone || conversation.store_phone].filter(Boolean).join(' · ');
  return `
    <header class="thread-header">
      <button type="button" class="text-button thread-back" data-thread-back>${icons.back}<span>All chats</span></button>
      <div class="thread-title">
        <h3>${escapeHtml(conversation.store_name || 'Store')}</h3>
        <p>${escapeHtml(owner || 'No contact details')}${conversation.subscription_status ? ` · ${escapeHtml(statusLabel(conversation.subscription_status))}` : ''}</p>
      </div>
      <div class="thread-actions">
        <button class="button secondary" type="button" data-store-id="${escapeHtml(conversation.store_id)}">Open store</button>
        <button class="button secondary" type="button" data-conversation-status="${open ? 'closed' : 'open'}">${open ? 'Close chat' : 'Reopen chat'}</button>
      </div>
    </header>
    <ol class="thread-log" data-thread-log aria-label="Messages" aria-live="polite">${messages.map(threadMessageMarkup).join('')}</ol>
    <form class="thread-reply" data-reply-form novalidate>
      <label class="sr-only" for="reply-body">Reply to ${escapeHtml(conversation.store_name || 'store')}</label>
      <textarea id="reply-body" name="body" rows="3" maxlength="4000" placeholder="Write a reply. The store sees it in their POS app."></textarea>
      <div class="quick-replies" aria-label="Quick replies">
        ${QUICK_REPLIES.map((text, index) => `<button type="button" class="chip-button" data-quick-reply="${index}">${escapeHtml(text.length > 34 ? `${text.slice(0, 32)}…` : text)}</button>`).join('')}
      </div>
      <div class="thread-reply-actions">
        <p class="form-error" role="alert" data-reply-error></p>
        <span class="muted-line">Ctrl+Enter to send</span>
        <button class="button primary" type="submit">Send reply</button>
      </div>
    </form>
  `;
}

function lastThreadMessageId() {
  const messages = state.thread?.messages || [];
  return messages.length ? messages[messages.length - 1].id : 0;
}

function scrollThreadToEnd() {
  const log = document.querySelector('[data-thread-log]');
  if (log) log.scrollTop = log.scrollHeight;
}

function appendThreadMessages(messages) {
  const log = document.querySelector('[data-thread-log]');
  if (!log || !messages.length) return;
  const known = new Set((state.thread?.messages || []).map((message) => message.id));
  const fresh = messages.filter((message) => !known.has(message.id));
  if (!fresh.length) return;
  state.thread.messages.push(...fresh);
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  log.insertAdjacentHTML('beforeend', fresh.map(threadMessageMarkup).join(''));
  if (nearBottom || fresh.some((message) => message.sender_type === 'admin')) scrollThreadToEnd();
}

async function loadThread({ initial = false } = {}) {
  const id = state.currentConversationId;
  const container = document.querySelector('[data-inbox-thread]');
  if (!id || !container) return;
  const after = initial ? 0 : lastThreadMessageId();
  try {
    const data = await api.get(`/platform/inbox/${encodeURIComponent(id)}${after ? `?after=${after}` : ''}`);
    if (id !== state.currentConversationId) return;
    if (initial) {
      state.thread = data;
      container.innerHTML = threadMarkup(data.conversation, data.messages || []);
      scrollThreadToEnd();
      document.querySelector(`[data-conversation-id="${id}"]`)?.classList.remove('unread');
      pollInboxSummary();
    } else {
      appendThreadMessages(data.messages || []);
    }
  } catch (error) {
    if (initial) {
      container.innerHTML = error.code === 'MIGRATION_REQUIRED'
        ? migrationMarkup('Live chat')
        : `<div class="error-state" role="alert"><strong>Could not load this chat</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

function stopThreadPolling() {
  window.clearInterval(state.threadTimer);
  state.threadTimer = null;
}

function startThreadPolling() {
  stopThreadPolling();
  state.threadTimer = window.setInterval(() => {
    if (state.view !== 'inbox' || !state.currentConversationId) {
      stopThreadPolling();
      return;
    }
    if (!document.hidden) loadThread();
  }, 5000);
}

async function openConversation(id) {
  state.currentConversationId = Number(id);
  document.querySelector('[data-inbox-layout]')?.classList.add('has-thread');
  document.querySelectorAll('[data-conversation-id]').forEach((row) => {
    const active = Number(row.dataset.conversationId) === state.currentConversationId;
    row.classList.toggle('active', active);
    if (active) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  });
  const container = document.querySelector('[data-inbox-thread]');
  if (container) container.innerHTML = loadingMarkup('Loading conversation');
  await loadThread({ initial: true });
  startThreadPolling();
  document.getElementById('reply-body')?.focus({ preventScroll: true });
}

async function refreshInboxList() {
  if (state.view !== 'inbox') return;
  try {
    const params = new URLSearchParams({ status: state.inboxStatus, page: String(state.page) });
    const data = await api.get(`/platform/inbox?${params}`);
    const list = document.querySelector('[data-inbox-list]');
    if (list) list.innerHTML = inboxListMarkup(data);
  } catch { /* The next poll will try again. */ }
}

async function sendReply(form) {
  const field = form.querySelector('textarea');
  const error = form.querySelector('[data-reply-error]');
  const submit = form.querySelector('button[type="submit"]');
  const body = field.value.trim();
  error.textContent = '';
  if (!body) {
    error.textContent = 'Write a reply first.';
    field.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Sending…';
  try {
    const result = await api.post(`/platform/inbox/${encodeURIComponent(state.currentConversationId)}/messages`, { body });
    field.value = '';
    appendThreadMessages([result.message]);
    if (state.thread?.conversation) state.thread.conversation.status = 'open';
    announce('Reply sent');
    refreshInboxList();
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Send reply';
    field.focus();
  }
}

function syncInboxBadges() {
  document.querySelectorAll('[data-inbox-badge]').forEach((badge) => {
    badge.hidden = !state.inboxUnread;
    badge.textContent = state.inboxUnread > 9 ? '9+' : String(state.inboxUnread || 0);
  });
  document.querySelectorAll('[data-view="inbox"]').forEach((button) => {
    button.setAttribute('aria-label', state.inboxUnread ? `Inbox, ${state.inboxUnread} unread` : 'Inbox');
  });
}

async function pollInboxSummary() {
  if (document.hidden || document.body.dataset.authenticated !== 'true' || !api.accessToken) return;
  try {
    const summary = await api.get('/platform/inbox/summary');
    const changed = summary.unread !== state.inboxUnread;
    state.inboxUnread = Number(summary.unread || 0);
    syncInboxBadges();
    if (changed && state.view === 'inbox' && !state.loading) refreshInboxList();
  } catch { /* Badges are best effort. */ }
}

function startBackgroundPolling() {
  window.clearInterval(state.summaryTimer);
  pollInboxSummary();
  state.summaryTimer = window.setInterval(pollInboxSummary, 30000);
}

function stopAllPolling() {
  window.clearInterval(state.summaryTimer);
  state.summaryTimer = null;
  stopThreadPolling();
}

// Search
function openSearch() {
  const dialog = document.querySelector('[data-search-dialog]');
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  const input = dialog.querySelector('[data-global-search-input]');
  input?.focus();
  input?.select();
}

function searchResultsMarkup(data, term) {
  const groups = [
    ['Stores', (data.stores || []).map((store) => `<li><button type="button" class="search-result" data-store-id="${escapeHtml(store.id)}"><strong>${escapeHtml(store.name)}</strong><span>${escapeHtml([store.email, store.phone].filter(Boolean).join(' · ') || `Store #${store.id}`)}</span></button></li>`)],
    ['People', (data.people || []).map((person) => `<li><button type="button" class="search-result" data-store-id="${escapeHtml(person.store_id)}"><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(`${person.email} · ${titleCase(person.role)} at ${person.store_name}${person.is_active ? '' : ' · Sign-in disabled'}`)}</span></button></li>`)],
    ['Payments', (data.payments || []).map((payment) => `<li><button type="button" class="search-result" data-store-id="${escapeHtml(payment.store_id)}"><strong>${escapeHtml(payment.provider_reference)}</strong><span>${escapeHtml(`${payment.store_name} · ${formatMoney(payment.amount, payment.currency)} · ${titleCase(payment.status)} · ${formatDate(payment.date)}`)}</span></button></li>`)],
  ].filter(([, rows]) => rows.length);
  if (!groups.length) return `<p class="muted-line">Nothing matches “${escapeHtml(term)}”.</p>`;
  return groups.map(([label, rows]) => `<section class="search-group"><h3>${label}</h3><ul>${rows.join('')}</ul></section>`).join('');
}

let searchTimer = null;
function queueSearch(input) {
  window.clearTimeout(searchTimer);
  const term = input.value.trim();
  const results = document.querySelector('[data-search-results]');
  if (term.length < 2) {
    results.innerHTML = '<p class="muted-line">Type at least two letters of a store, person, email, phone number or payment reference.</p>';
    return;
  }
  searchTimer = window.setTimeout(async () => {
    results.innerHTML = '<p class="muted-line">Searching…</p>';
    try {
      const data = await api.get(`/platform/search?${new URLSearchParams({ q: term })}`);
      if (input.value.trim() !== term) return;
      results.innerHTML = searchResultsMarkup(data, term);
    } catch (error) {
      results.innerHTML = `<p class="muted-line">${escapeHtml(error.message)}</p>`;
    }
  }, 250);
}

// Store controls
function usageMarkup(usage, currency) {
  if (!usage) return '';
  const items = [
    ['Sales, last 30 days', formatMoney(usage.sales_30d, usage.currency || currency || 'NGN')],
    ['Orders, last 30 days', String(usage.orders_30d ?? 0)],
    ['Last sale', usage.last_order_at ? formatDate(usage.last_order_at, true) : 'No sales yet'],
    ['Products', String(usage.products ?? 0)],
    ['Customers', String(usage.customers ?? 0)],
    ['Staff accounts', String(usage.staff ?? 0)],
    ['Last sign-in', usage.last_login_at ? formatDate(usage.last_login_at, true) : 'Never'],
  ];
  return `
    <section class="dialog-section" aria-labelledby="store-usage-title">
      <div class="section-heading"><div><span class="section-label">How the store uses QuickPOS</span><h3 id="store-usage-title">Usage</h3></div></div>
      <dl class="usage-strip">${items.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    </section>
  `;
}

function storeIsSuspended(data) {
  const latest = (data.activity || []).find((entry) => ['store_suspended', 'store_restored'].includes(entry.action));
  return latest?.action === 'store_suspended';
}

function moreStoreActionsMarkup(store, data) {
  const permanent = store.subscription_status === 'grandfathered';
  const suspended = storeIsSuspended(data);
  const today = new Date().toISOString().slice(0, 10);
  const firstPlan = store.activation_fee_paid ? PLAN_OPTIONS[1] : PLAN_OPTIONS[0];
  const currency = store.currency === 'USD' ? 'USD' : 'NGN';
  return `
    <form class="action-card" data-manual-payment-form novalidate>
      <h4>${icons.payments}Record a payment</h4>
      <p>For bank transfers or cash paid outside Paystack and Flutterwave. It activates the plan and emails a receipt.</p>
      <label for="manual-plan">Plan</label>
      <select id="manual-plan" name="plan_code" data-plan-select>
        ${PLAN_OPTIONS.map((plan) => `<option value="${plan.code}" ${plan.code === firstPlan.code ? 'selected' : ''} ${plan.code === 'activation_5m' && store.activation_fee_paid ? 'disabled' : ''}>${escapeHtml(plan.label)}</option>`).join('')}
      </select>
      <div class="form-pair">
        <div><label for="manual-amount">Amount received</label><input id="manual-amount" name="amount" type="number" min="0" step="1" inputmode="numeric" value="${firstPlan[currency]}"></div>
        <div><label for="manual-currency">Currency</label><select id="manual-currency" name="currency" data-plan-select><option value="NGN" ${currency === 'NGN' ? 'selected' : ''}>NGN</option><option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD</option></select></div>
      </div>
      <label for="manual-reference">Bank or transfer reference</label>
      <input id="manual-reference" name="reference" type="text" maxlength="120" autocomplete="off" placeholder="e.g. GTB transfer 0049812">
      <label for="manual-date">Date received</label>
      <input id="manual-date" name="paid_at" type="date" max="${today}" value="${today}">
      <label for="manual-note">Note (optional)</label>
      <input id="manual-note" name="note" type="text" maxlength="300" autocomplete="off">
      <p class="form-error" role="alert" data-manual-error></p>
      <button class="button primary" type="submit">Record payment</button>
    </form>
    <form class="action-card" data-message-store-form novalidate>
      <h4>${icons.chat}Message this store</h4>
      <p>Starts a chat the store sees in their POS app. Replies come to the Inbox.</p>
      <label for="store-message">Message</label>
      <textarea id="store-message" name="body" rows="3" maxlength="4000" placeholder="e.g. Hi, we noticed your payment did not go through. Can we help?"></textarea>
      <p class="form-error" role="alert" data-message-error></p>
      <button class="button secondary" type="submit">Send message</button>
    </form>
    <div class="action-card">
      <h4>${icons.lock}Access controls</h4>
      <p>${suspended ? 'This store is suspended: its sign-ins were disabled from QP Control.' : 'Suspend blocks every sign-in for this store at once. Restore brings back the same people.'}</p>
      <div class="action-buttons">
        <button class="button ${suspended ? 'secondary' : 'danger-quiet'}" type="button" data-suspend-store="${suspended ? 'false' : 'true'}">${suspended ? 'Restore store' : 'Suspend store'}</button>
        <button class="button secondary" type="button" data-permanent-access="${permanent ? 'false' : 'true'}">${permanent ? 'Remove permanent access' : 'Give permanent access'}</button>
      </div>
    </div>
  `;
}

async function handleManualPayment(form) {
  const error = form.querySelector('[data-manual-error]');
  const values = new FormData(form);
  const payload = {
    plan_code: String(values.get('plan_code')),
    amount: Number(values.get('amount')),
    currency: String(values.get('currency') || 'NGN'),
    reference: String(values.get('reference') || '').trim(),
    paid_at: values.get('paid_at') ? new Date(`${values.get('paid_at')}T12:00:00`).toISOString() : undefined,
    note: String(values.get('note') || '').trim() || undefined,
  };
  error.textContent = '';
  if (!Number.isFinite(payload.amount) || payload.amount < 0) {
    error.textContent = 'Enter the amount received.';
    form.querySelector('#manual-amount')?.focus();
    return;
  }
  if (payload.reference.length < 3) {
    error.textContent = 'Enter the bank or transfer reference, so the payment can be traced.';
    form.querySelector('#manual-reference')?.focus();
    return;
  }
  if (payload.paid_at && new Date(payload.paid_at).getTime() > Date.now() + 86400000) {
    error.textContent = 'The date received cannot be in the future.';
    return;
  }
  const plan = PLAN_OPTIONS.find((option) => option.code === payload.plan_code);
  const storeName = document.getElementById('store-dialog-title')?.textContent || 'this store';
  const storeId = state.currentStoreId;
  askForConfirmation({
    title: `Record ${formatMoney(payload.amount, payload.currency)} for ${storeName}?`,
    description: `This marks a ${plan?.label || payload.plan_code} payment (reference ${payload.reference}) as received, extends the store's access and emails a receipt. Only record money that has actually arrived.`,
    confirmLabel: 'Record payment',
    tone: 'primary',
    action: async () => {
      const result = await api.post(`/platform/stores/${encodeURIComponent(storeId)}/manual-payment`, payload);
      await reloadStoreDialog({ message: `Payment recorded. Access runs to ${formatDate(result.subscription?.current_period_end)}.`, focus: '[data-action-status]' });
    },
  });
}

async function handleMessageStore(form) {
  const error = form.querySelector('[data-message-error]');
  const submit = form.querySelector('button[type="submit"]');
  const body = String(new FormData(form).get('body') || '').trim();
  error.textContent = '';
  if (!body) {
    error.textContent = 'Write a message first.';
    form.querySelector('textarea')?.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Sending…';
  try {
    const result = await api.post(`/platform/stores/${encodeURIComponent(state.currentStoreId)}/chat`, { body });
    state.lastStartedConversation = result.conversation?.id || null;
    await reloadStoreDialog({ message: 'Message sent. The store sees it in their POS app, and replies come to the Inbox.', focus: '[data-action-status]' });
  } catch (requestError) {
    error.textContent = requestError.code === 'MIGRATION_REQUIRED' ? 'Live chat needs a database update first.' : requestError.message;
    submit.disabled = false;
    submit.textContent = 'Send message';
  }
}

function syncManualAmount(form) {
  const plan = PLAN_OPTIONS.find((option) => option.code === form.querySelector('#manual-plan')?.value);
  const currency = form.querySelector('#manual-currency')?.value || 'NGN';
  const amount = form.querySelector('#manual-amount');
  if (plan && amount) amount.value = plan[currency];
}

async function verifyPayment(button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const result = await api.post(`/platform/payments/${encodeURIComponent(button.dataset.verifyPayment)}/verify`, {});
    const message = result.status === 'success'
      ? 'The provider confirmed the payment. The store is now active.'
      : result.status === 'paid_duplicate' ? 'The provider confirmed it, but it duplicates an activation the store already paid. Review it.' : `Status: ${titleCase(result.status)}`;
    announce(message);
    window.alert(message);
    if (state.currentStoreId && document.querySelector('[data-store-dialog]')?.open) await reloadStoreDialog({ message });
    else await loadCurrentView();
  } catch (error) {
    announce(error.message);
    window.alert(error.message);
    button.disabled = false;
    button.textContent = label;
  }
}

// Announcements
function announcementRow(item) {
  const live = Boolean(item.is_live);
  const levels = { info: 'Information', warning: 'Warning', success: 'Good news' };
  return `
    <li class="announcement-row">
      <span class="status-badge ${live ? 'success' : ''}">${live ? 'Live' : 'Ended'}</span>
      <div class="row-main">
        <strong>${escapeHtml(item.title)}</strong>
        <p class="activity-detail">${escapeHtml(item.body)}</p>
        <span>${escapeHtml(`${levels[item.level] || item.level} · Posted ${formatDate(item.created_at, true)}${item.created_by_name ? ` by ${item.created_by_name}` : ''}${item.ends_at ? ` · ${live ? 'Ends' : 'Ended'} ${formatDate(item.ends_at, true)}` : ''}`)}</span>
      </div>
      ${live ? `<button class="button danger-quiet" type="button" data-end-announcement="${escapeHtml(item.id)}" data-announcement-title="${escapeHtml(item.title)}">End now</button>` : ''}
    </li>
  `;
}

function announcementsMarkup(data) {
  const items = data.announcements || [];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return `
    <section class="page-intro"><div><span class="section-label">Inside the POS app</span><h2>Announcements</h2></div><p>Post a short notice that every store sees at the top of their POS app, such as planned maintenance or a new feature. Stores can dismiss it.</p></section>
    <form class="panel-form" data-announcement-form novalidate>
      <h3>New announcement</h3>
      <label for="announcement-title">Title</label>
      <input id="announcement-title" name="title" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Planned maintenance on Sunday">
      <label for="announcement-body">Message</label>
      <textarea id="announcement-body" name="body" rows="3" maxlength="600" placeholder="What stores need to know, in one or two sentences"></textarea>
      <div class="form-pair">
        <div><label for="announcement-level">Style</label><select id="announcement-level" name="level"><option value="info">Information</option><option value="warning">Warning</option><option value="success">Good news</option></select></div>
        <div><label for="announcement-ends">Show until (optional)</label><input id="announcement-ends" name="ends_at" type="date" min="${tomorrow}"></div>
      </div>
      <p class="form-error" role="alert" data-announcement-error></p>
      <button class="button primary" type="submit">Publish to all stores</button>
    </form>
    <section class="data-section" aria-labelledby="announcement-list-title">
      <div class="section-heading"><div><span class="section-label">History</span><h2 id="announcement-list-title">Posted announcements</h2></div></div>
      ${items.length ? `<ul class="data-list announcement-list">${items.map(announcementRow).join('')}</ul>` : emptyMarkup('No announcements yet', 'Announcements you publish will be listed here.')}
    </section>
  `;
}

async function handleAnnouncement(form) {
  const error = form.querySelector('[data-announcement-error]');
  const values = new FormData(form);
  const payload = {
    title: String(values.get('title') || '').trim(),
    body: String(values.get('body') || '').trim(),
    level: String(values.get('level') || 'info'),
    ends_at: values.get('ends_at') ? new Date(`${values.get('ends_at')}T23:59:59`).toISOString() : undefined,
  };
  error.textContent = '';
  if (payload.title.length < 3) {
    error.textContent = 'Add a short title.';
    form.querySelector('#announcement-title')?.focus();
    return;
  }
  if (payload.body.length < 3) {
    error.textContent = 'Write the announcement.';
    form.querySelector('#announcement-body')?.focus();
    return;
  }
  askForConfirmation({
    title: 'Publish to every store?',
    description: `“${payload.title}” will appear at the top of every store's POS app${payload.ends_at ? ` until ${formatDate(payload.ends_at)}` : ' until you end it'}.`,
    confirmLabel: 'Publish',
    tone: 'primary',
    action: async () => {
      await api.post('/platform/announcements', payload);
      announce('Announcement published');
    },
  });
}

// Team
function teamMarkup(data) {
  const admins = data.admins || [];
  return `
    <section class="page-intro"><div><span class="section-label">Platform admins</span><h2>Team</h2></div><p>People who can sign in to QP Control. Everyone here can see every store and make changes, and every change is logged in Activity.</p></section>
    <section class="data-section data-section-full" aria-label="Platform admins">
      <ul class="data-list team-list">
        ${admins.map((admin) => `
          <li class="team-row">
            <span class="store-avatar" aria-hidden="true">${escapeHtml(String(admin.name || admin.email || 'A').charAt(0).toUpperCase())}</span>
            <div class="row-main">
              <strong>${escapeHtml(admin.name || admin.email)}${admin.is_you ? ' <span class="status-badge success">You</span>' : ''}</strong>
              <span>${escapeHtml(`${admin.email}${admin.store_name ? ` · ${admin.store_name}` : ''}`)}</span>
              <span>${escapeHtml(`Added ${formatDate(admin.granted_at)}${admin.granted_by_name ? ` by ${admin.granted_by_name}` : ''} · Last sign-in ${admin.last_login ? formatDate(admin.last_login, true) : 'never'}`)}</span>
            </div>
            ${admin.is_you ? '' : `<button class="button danger-quiet" type="button" data-remove-admin="${escapeHtml(admin.user_id)}" data-admin-name="${escapeHtml(admin.name || admin.email)}">Remove</button>`}
          </li>`).join('')}
      </ul>
    </section>
    <form class="panel-form" data-admin-form novalidate>
      <h3>Add a platform admin</h3>
      <p class="muted-line">The person needs a QuickPOS account first. Only add people you trust with every store's data.</p>
      <label for="admin-email">Their QuickPOS account email</label>
      <input id="admin-email" name="email" type="email" autocomplete="off" inputmode="email" spellcheck="false">
      <p class="form-error" role="alert" data-admin-error></p>
      <button class="button primary" type="submit">Add admin</button>
    </form>
  `;
}

// System
function systemMarkup(data) {
  const features = data.features || {};
  const checks = [
    ['Database', data.database?.ok, data.database?.ok ? `Responding in ${data.database.latency_ms} ms` : 'Not responding'],
    ['Live chat and announcements', features.live_chat && features.announcements, features.live_chat && features.announcements ? 'Database tables are ready' : 'Needs the latest database update (npm run db:migrate)'],
    ['Email', data.email?.configured, data.email?.configured ? 'Receipts, resets and reminders can be sent' : 'RESEND_API_KEY or EMAIL_FROM is not set'],
    ['Paystack', data.payments?.paystack, data.payments?.paystack ? 'Secret key is set' : 'PAYSTACK_SECRET_KEY is not set'],
    ['Flutterwave', data.payments?.flutterwave, data.payments?.flutterwave ? 'Secret key is set' : 'FLUTTERWAVE_SECRET_KEY is not set'],
    ['Scheduled jobs', data.scheduled_jobs?.configured, data.scheduled_jobs?.configured ? 'Reminders and payment checks can run' : 'CRON_SECRET is not set'],
  ];
  return `
    <section class="page-intro"><div><span class="section-label">Health and setup</span><h2>System</h2></div><p>What the QuickPOS server can do right now. Secrets are never shown here, only whether they are set.</p></section>
    <div class="system-grid">
      ${checks.map(([label, ok, detail]) => `<article class="system-card"><span class="status-badge ${ok ? 'success' : 'warning'}">${ok ? 'Ready' : 'Needs setup'}</span><h3>${escapeHtml(label)}</h3><p>${escapeHtml(detail)}</p></article>`).join('')}
    </div>
    <dl class="system-facts">
      <div><dt>Server version</dt><dd>${escapeHtml(data.version || 'Not reported')}</dd></div>
      <div><dt>Environment</dt><dd>${escapeHtml(titleCase(data.environment || 'unknown'))}</dd></div>
      <div><dt>Server time</dt><dd>${escapeHtml(formatDate(data.server_time, true))}</dd></div>
    </dl>
    <section class="data-section" aria-labelledby="plans-title">
      <div class="section-heading"><div><span class="section-label">Billing</span><h2 id="plans-title">Plans</h2></div></div>
      <div class="table-scroll">
        <table class="plain-table">
          <thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Length</th><th scope="col">Stores on it now</th><th scope="col">Status</th></tr></thead>
          <tbody>${(data.plans || []).map((plan) => `<tr><th scope="row">${escapeHtml(plan.name)} <small>${escapeHtml(plan.code)}</small></th><td>${escapeHtml(formatMoney(plan.price_ngn, 'NGN'))}</td><td>${escapeHtml(`${plan.duration_months} month${plan.duration_months === 1 ? '' : 's'}${plan.recurring ? ', renews' : ''}`)}</td><td>${escapeHtml(plan.active_stores)}</td><td>${plan.is_active ? 'On sale' : 'Retired'}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="data-section" aria-labelledby="migrations-title">
      <div class="section-heading"><div><span class="section-label">Database</span><h2 id="migrations-title">Applied database updates</h2></div></div>
      ${(data.migrations || []).length
        ? `<ul class="migration-list">${data.migrations.map((migration) => `<li><code>${escapeHtml(migration.name)}</code><span>${escapeHtml(formatDate(migration.applied_at, true))}</span></li>`).join('')}</ul>`
        : '<p class="muted-line">No update history found.</p>'}
    </section>
  `;
}

function moreMenuMarkup() {
  return `
    <dialog class="more-dialog" data-more-dialog aria-labelledby="more-title">
      <div class="more-shell">
        <div class="more-head"><h2 id="more-title">More</h2><button class="icon-button" type="button" data-dialog-close aria-label="Close menu">${icons.close}</button></div>
        <nav class="more-nav" aria-label="More pages">
          ${navButton('activity', 'Activity')}
          ${navButton('announcements', 'Announcements')}
          ${navButton('team', 'Team')}
          ${navButton('system', 'System')}
        </nav>
      </div>
    </dialog>
    <dialog class="search-dialog" data-search-dialog aria-labelledby="search-title">
      <div class="search-shell">
        <div class="search-head">
          <h2 id="search-title" class="sr-only">Search QP Control</h2>
          <label class="search-field">
            <span class="sr-only">Search stores, people, emails, phone numbers and payment references</span>
            ${icons.search}
            <input type="search" data-global-search-input placeholder="Search stores, people, references…" autocomplete="off" spellcheck="false">
          </label>
          <button class="icon-button" type="button" data-dialog-close aria-label="Close search">${icons.close}</button>
        </div>
        <div class="search-results" data-search-results aria-live="polite"><p class="muted-line">Type at least two letters of a store, person, email, phone number or payment reference.</p></div>
      </div>
    </dialog>
  `;
}

async function openStore(storeId) {
  const dialog = document.querySelector('[data-store-dialog]');
  const content = document.querySelector('[data-store-dialog-content]');
  state.currentStoreId = storeId;
  content.innerHTML = loadingMarkup('Loading store account');
  if (!dialog.open) dialog.showModal();
  try {
    const data = await fetchStoreDetail(storeId);
    content.innerHTML = storeDialogMarkup(data);
  } catch (error) {
    content.innerHTML = `<div class="error-state" role="alert"><strong>Could not load store</strong><p>${escapeHtml(error.message)}</p><button class="button secondary" type="button" data-dialog-close>Close</button></div>`;
  }
}

function askForConfirmation({ title, description, confirmLabel, action, tone = 'danger', reason = null }) {
  state.pendingConfirmation = action;
  const dialog = document.querySelector('[data-confirm-dialog]');
  dialog.returnValue = '';
  const reasonBox = dialog.querySelector('[data-confirm-reason]');
  state.confirmNeedsReason = Boolean(reason);
  if (reasonBox) {
    reasonBox.hidden = !reason;
    reasonBox.querySelector('[data-confirm-reason-label]').textContent = reason?.label || 'Reason';
    reasonBox.querySelector('input').value = '';
    reasonBox.querySelector('input').placeholder = reason?.placeholder || '';
    reasonBox.querySelector('[data-confirm-reason-error]').textContent = '';
  }
  dialog.querySelector('[data-confirm-title]').textContent = title;
  dialog.querySelector('[data-confirm-description]').textContent = description;
  const submit = dialog.querySelector('[data-confirm-submit]');
  submit.textContent = confirmLabel;
  submit.className = `button ${tone === 'primary' ? 'primary' : 'danger'}`;
  dialog.querySelector('.confirm-mark')?.classList.toggle('neutral', tone === 'primary');
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
    return;
  }
  const noteForm = event.target.closest('[data-note-form]');
  if (noteForm) {
    event.preventDefault();
    handleNoteSubmit(noteForm);
    return;
  }
  const extendForm = event.target.closest('[data-extend-form]');
  if (extendForm) {
    event.preventDefault();
    handleExtendSubmit(extendForm);
    return;
  }
  const replyForm = event.target.closest('[data-reply-form]');
  if (replyForm) {
    event.preventDefault();
    sendReply(replyForm);
    return;
  }
  const manualForm = event.target.closest('[data-manual-payment-form]');
  if (manualForm) {
    event.preventDefault();
    handleManualPayment(manualForm);
    return;
  }
  const messageForm = event.target.closest('[data-message-store-form]');
  if (messageForm) {
    event.preventDefault();
    handleMessageStore(messageForm);
    return;
  }
  const announcementForm = event.target.closest('[data-announcement-form]');
  if (announcementForm) {
    event.preventDefault();
    handleAnnouncement(announcementForm);
    return;
  }
  const adminForm = event.target.closest('[data-admin-form]');
  if (adminForm) {
    event.preventDefault();
    const email = String(new FormData(adminForm).get('email') || '').trim().toLowerCase();
    const error = adminForm.querySelector('[data-admin-error]');
    error.textContent = '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      error.textContent = 'Enter the email address of their QuickPOS account.';
      adminForm.querySelector('input')?.focus();
      return;
    }
    askForConfirmation({
      title: `Make ${email} a platform admin?`,
      description: 'They will see every store, payment and chat, and can change access. You can remove them later from Team.',
      confirmLabel: 'Add admin',
      tone: 'primary',
      action: async () => {
        await api.post('/platform/admins', { email });
        announce(`${email} added as a platform admin`);
      },
    });
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
    closeOverlays();
    await openStore(storeButton.dataset.storeId);
    return;
  }
  if (event.target.closest('[data-dialog-close]')) {
    event.target.closest('dialog')?.close();
    return;
  }
  const exportButton = event.target.closest('[data-export]');
  if (exportButton && !exportButton.disabled) {
    await exportCurrentList(exportButton.dataset.export, exportButton);
    return;
  }
  const resendButton = event.target.closest('[data-resend-email]');
  if (resendButton && !resendButton.disabled) {
    await handleResendEmail(resendButton);
    return;
  }
  if (event.target.closest('[data-open-search]')) {
    openSearch();
    return;
  }
  if (event.target.closest('[data-open-more]')) {
    const more = document.querySelector('[data-more-dialog]');
    if (more && !more.open) more.showModal();
    return;
  }
  const inboxFilter = event.target.closest('[data-inbox-status]');
  if (inboxFilter) {
    state.inboxStatus = inboxFilter.dataset.inboxStatus;
    state.page = 1;
    state.currentConversationId = null;
    stopThreadPolling();
    await loadCurrentView();
    return;
  }
  const conversationButton = event.target.closest('[data-conversation-id]');
  if (conversationButton) {
    await openConversation(conversationButton.dataset.conversationId);
    return;
  }
  if (event.target.closest('[data-thread-back]')) {
    state.currentConversationId = null;
    stopThreadPolling();
    document.querySelector('[data-inbox-layout]')?.classList.remove('has-thread');
    const thread = document.querySelector('[data-inbox-thread]');
    if (thread) thread.innerHTML = '<div class="empty-state"><strong>Choose a conversation</strong><p>Select a chat to read it and reply.</p></div>';
    await refreshInboxList();
    document.querySelector('[data-conversation-id]')?.focus();
    return;
  }
  const conversationStatus = event.target.closest('[data-conversation-status]');
  if (conversationStatus && !conversationStatus.disabled) {
    conversationStatus.disabled = true;
    try {
      await api.patch(`/platform/inbox/${encodeURIComponent(state.currentConversationId)}`, { status: conversationStatus.dataset.conversationStatus });
      announce(conversationStatus.dataset.conversationStatus === 'closed' ? 'Chat closed' : 'Chat reopened');
      await loadThread({ initial: true });
      await refreshInboxList();
    } catch (error) {
      window.alert(error.message);
      conversationStatus.disabled = false;
    }
    return;
  }
  const quickReply = event.target.closest('[data-quick-reply]');
  if (quickReply) {
    const field = document.getElementById('reply-body');
    const text = QUICK_REPLIES[Number(quickReply.dataset.quickReply)] || '';
    if (field) {
      field.value = field.value.trim() ? `${field.value.trimEnd()} ${text}` : text;
      field.focus();
    }
    return;
  }
  const openConversationButton = event.target.closest('[data-open-conversation]');
  if (openConversationButton) {
    closeOverlays();
    document.querySelector('[data-store-dialog]')?.close();
    state.view = 'inbox';
    state.inboxStatus = 'open';
    state.page = 1;
    state.search = '';
    state.status = 'all';
    state.currentConversationId = Number(openConversationButton.dataset.openConversation);
    syncUrlState();
    await loadCurrentView({ focus: true });
    return;
  }
  const verifyButton = event.target.closest('[data-verify-payment]');
  if (verifyButton && !verifyButton.disabled) {
    await verifyPayment(verifyButton);
    return;
  }
  const resetButton = event.target.closest('[data-password-reset]');
  if (resetButton) {
    const name = resetButton.dataset.userName;
    const email = resetButton.dataset.userEmail;
    const userId = resetButton.dataset.passwordReset;
    askForConfirmation({
      title: `Send a password reset link to ${name}?`,
      description: `${email} gets an email with a one-time link to choose a new password. The current password keeps working until they change it.`,
      confirmLabel: 'Send link',
      tone: 'primary',
      action: async () => {
        await api.post(`/platform/users/${encodeURIComponent(userId)}/password-reset`, {});
        await reloadStoreDialog({ message: `Reset link sent to ${email}.`, focus: '[data-action-status]' });
      },
    });
    return;
  }
  const suspendButton = event.target.closest('[data-suspend-store]');
  if (suspendButton) {
    const suspending = suspendButton.dataset.suspendStore === 'true';
    const storeName = document.getElementById('store-dialog-title')?.textContent || 'this store';
    const storeId = state.currentStoreId;
    askForConfirmation({
      title: suspending ? `Suspend ${storeName}?` : `Restore ${storeName}?`,
      description: suspending
        ? 'Everyone at this store is signed out and cannot sign in until you restore it. Their data and payment history are kept.'
        : 'The people this suspension disabled can sign in again with their current passwords.',
      confirmLabel: suspending ? 'Suspend store' : 'Restore store',
      tone: suspending ? 'danger' : 'primary',
      reason: { label: 'Reason (saved in the activity log)', placeholder: suspending ? 'e.g. Payment dispute' : 'e.g. Dispute resolved' },
      action: async (reason) => {
        const result = await api.post(`/platform/stores/${encodeURIComponent(storeId)}/suspend`, { suspended: suspending, reason });
        await reloadStoreDialog({
          message: suspending
            ? `Store suspended. ${result.users} sign-in${result.users === 1 ? '' : 's'} disabled.`
            : `Store restored. ${result.users} sign-in${result.users === 1 ? '' : 's'} enabled.`,
          focus: '[data-action-status]',
        });
      },
    });
    return;
  }
  const permanentButton = event.target.closest('[data-permanent-access]');
  if (permanentButton) {
    const granting = permanentButton.dataset.permanentAccess === 'true';
    const storeName = document.getElementById('store-dialog-title')?.textContent || 'this store';
    const storeId = state.currentStoreId;
    askForConfirmation({
      title: granting ? `Give ${storeName} permanent access?` : `Remove permanent access from ${storeName}?`,
      description: granting
        ? 'The store keeps full access with no expiry date and no further payments. Use this for partners or special arrangements.'
        : 'The store goes back to its paid-through date. If that date has passed, it becomes read-only straight away.',
      confirmLabel: granting ? 'Give permanent access' : 'Remove permanent access',
      tone: granting ? 'primary' : 'danger',
      reason: { label: 'Reason (saved in the activity log)', placeholder: granting ? 'e.g. Launch partner' : 'e.g. Partnership ended' },
      action: async (reason) => {
        const result = await api.post(`/platform/stores/${encodeURIComponent(storeId)}/permanent`, { permanent: granting, reason });
        await reloadStoreDialog({
          message: result.subscription?.status === 'grandfathered'
            ? 'Permanent access is on. This store no longer expires.'
            : `Permanent access removed. The store is now ${titleCase(result.subscription?.status)}.`,
          focus: '[data-action-status]',
        });
      },
    });
    return;
  }
  const endAnnouncement = event.target.closest('[data-end-announcement]');
  if (endAnnouncement) {
    askForConfirmation({
      title: `End “${endAnnouncement.dataset.announcementTitle}”?`,
      description: 'Stores stop seeing it the next time their POS app checks, within ten minutes.',
      confirmLabel: 'End announcement',
      action: async () => {
        await api.post(`/platform/announcements/${encodeURIComponent(endAnnouncement.dataset.endAnnouncement)}/end`, {});
        announce('Announcement ended');
      },
    });
    return;
  }
  const removeAdmin = event.target.closest('[data-remove-admin]');
  if (removeAdmin) {
    askForConfirmation({
      title: `Remove ${removeAdmin.dataset.adminName} from the team?`,
      description: 'They lose access to QP Control immediately. Their own store account is not affected.',
      confirmLabel: 'Remove admin',
      action: async () => {
        await api.request(`/platform/admins/${encodeURIComponent(removeAdmin.dataset.removeAdmin)}`, { method: 'DELETE' });
        announce('Platform admin removed');
      },
    });
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
        if (state.currentStoreId) await reloadStoreDialog();
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
    stopAllPolling();
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
    await action(event.target.querySelector('#confirm-reason-input')?.value.trim() || '');
    if (state.view !== 'overview' && state.view !== 'inbox') await loadCurrentView();
  } catch (error) {
    announce(`Change failed: ${error.message}`);
    window.alert(`The change could not be completed. ${error.message}`);
  } finally {
    submit.disabled = false;
  }
}, true);

// A reason is required for some confirmations; keep the dialog open until one is given.
document.addEventListener('submit', (event) => {
  const form = event.target.closest('.confirm-shell');
  if (!form || !state.confirmNeedsReason || event.submitter?.value !== 'confirm') return;
  const input = form.querySelector('#confirm-reason-input');
  if (input && input.value.trim().length < 3) {
    event.preventDefault();
    event.stopImmediatePropagation();
    form.querySelector('[data-confirm-reason-error]').textContent = 'Give a short reason. It is saved in the activity log.';
    input.focus();
  }
}, true);

document.addEventListener('input', (event) => {
  const input = event.target.closest('[data-global-search-input]');
  if (input) queueSearch(input);
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-plan-select]')) syncManualAmount(event.target.closest('form'));
});

document.addEventListener('keydown', (event) => {
  if (event.target.id === 'reply-body' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.target.closest('form')?.requestSubmit();
    return;
  }
  const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (!typing && event.key === '/' && document.body.dataset.authenticated === 'true' && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    openSearch();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollInboxSummary();
});

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
