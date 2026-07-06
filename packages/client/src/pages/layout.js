import { api } from '../api.js';
import { escapeHTML, icons } from '../utils.js';
import { getSubscription } from '../entitlement.js';
import { getLastSyncAt, getOfflineQueueCount, getOfflineQueueSummary } from '../offline.js';
import { attemptSync } from '../sync.js';

const ACCOUNT_PORTAL_URL = 'https://quickpos.com.ng/account#billing';

// Render the sidebar + main content shell
export function renderLayout(activePage) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const app = document.getElementById('app');

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: icons.dashboard, hash: '#/dashboard', roles: ['admin', 'manager', 'cashier'] },
    { id: 'pos', label: 'POS Terminal', icon: icons.pos, hash: '#/pos', roles: ['admin', 'manager', 'cashier'] },
    { id: 'products', label: 'Products', icon: icons.products, hash: '#/products', roles: ['admin', 'manager'] },
    { id: 'inventory', label: 'Inventory', icon: icons.inventory, hash: '#/inventory', roles: ['admin', 'manager'] },
    { id: 'customers', label: 'Customers', icon: icons.customers, hash: '#/customers', roles: ['admin', 'manager', 'cashier'] },
    { id: 'orders', label: 'Orders', icon: icons.orders, hash: '#/orders', roles: ['admin', 'manager'] },
    { id: 'reports', label: 'Reports', icon: icons.reports, hash: '#/reports', roles: ['admin', 'manager'] },
    { id: 'settings', label: 'Settings', icon: icons.settings, hash: '#/settings', roles: ['admin', 'manager'] },
  ];

  const visibleNav = navItems.filter(item => item.roles.includes(user.role));

  app.innerHTML = `
    <div class="app-layout">
      <!-- Mobile menu button -->
      <button id="mobile-menu-btn" class="btn btn-ghost" type="button" aria-label="Open navigation menu" aria-expanded="false" style="position:fixed;top:0.75rem;left:0.75rem;z-index:60;padding:0.5rem;">
        ${icons.menu}
      </button>

      <!-- Sidebar overlay backdrop -->
      <div class="sidebar-overlay" id="sidebar-overlay"></div>

      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <div class="app-brand"><img src="./brand/quickpos-mark.svg" alt="" width="36" height="36"><span>QuickPOS</span></div>
          <p>${escapeHTML(user.name || 'User')} · ${escapeHTML((user.role || 'cashier').charAt(0).toUpperCase() + (user.role || '').slice(1))}</p>
        </div>
        <nav class="sidebar-nav">
          ${visibleNav.map(item => `
            <a href="${item.hash}" class="nav-item ${activePage === item.id ? 'active' : ''}" data-page="${item.id}" ${activePage === item.id ? 'aria-current="page"' : ''}>
              ${item.icon}
              <span>${item.label}</span>
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="offline-status" id="offline-status"></div>
          <button id="logout-btn" class="nav-item" style="color:var(--color-danger);">
            ${icons.logout}
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main class="main-content">
        <div id="subscription-banner"></div>
        <div id="page-content">
          <div style="display:flex;align-items:center;justify-content:center;height:60vh;">
            <div class="spinner spinner-lg"></div>
          </div>
        </div>
      </main>
    </div>
  `;

  // Logout handler
  document.getElementById('logout-btn').addEventListener('click', async () => {
    const pending = getOfflineQueueCount();
    if (pending > 0 && !confirm(`${pending} offline change${pending === 1 ? ' is' : 's are'} still saved on this device. Sign out anyway?`)) {
      return;
    }
    try {
      if (navigator.onLine) await api.post('/auth/logout', { refreshToken: api.refreshToken });
    } catch {}
    api.clearTokens();
    window.location.hash = '#/login';
  });

  function renderSubscriptionBanner() {
    const subscription = getSubscription();
    const banner = document.getElementById('subscription-banner');
    if (!banner || !subscription || subscription.status === 'grandfathered') return;

    const show =
      subscription.activation_required ||
      subscription.status === 'trialing' ||
      !subscription.can_write ||
      subscription.cancel_at_period_end;
    if (!show) {
      banner.innerHTML = '';
      return;
    }
    const message = subscription.activation_required && subscription.status === 'pending_activation'
      ? 'Activate QuickPOS for ₦20,000 to unlock all features for five months.'
      : subscription.status === 'trialing'
        ? `${subscription.days_remaining ?? 0} day${subscription.days_remaining === 1 ? '' : 's'} left in your existing trial. Initial activation is required afterward.`
      : subscription.cancel_at_period_end && subscription.can_write
        ? `Renewal is cancelled. Access continues through ${new Date(subscription.current_period_end).toLocaleDateString('en-NG')}.`
        : 'QuickPOS is read-only. Reports, exports, printing, and statement email are still available.';
    banner.innerHTML = `
      <div class="subscription-banner ${subscription.can_write ? 'trial' : 'expired'}">
        <span>${message}</span>
        ${user.role === 'admin' ? `<a href="${ACCOUNT_PORTAL_URL}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary">Open account portal</a>` : ''}
      </div>
    `;
  }
  renderSubscriptionBanner();
  window.addEventListener('subscription-updated', renderSubscriptionBanner, { once: true });

  let currentSyncState = 'idle';

  function renderOfflineStatus() {
    const status = document.getElementById('offline-status');
    if (!status) return;
    const summary = getOfflineQueueSummary();
    const queued = summary.count;
    const offline = !navigator.onLine;
    const syncing = ['checking', 'syncing', 'refreshing', 'retrying'].includes(currentSyncState);
    const attention = summary.needs_attention > 0 || currentSyncState === 'attention';
    const stateClass = offline ? 'offline' : attention ? 'attention' : syncing || queued > 0 ? 'pending' : 'online';
    const lastSync = getLastSyncAt();
    const lastSyncCopy = lastSync
      ? `Updated ${new Date(lastSync).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Connect once to prepare offline data';
    status.className = `offline-status ${stateClass}`;
    status.innerHTML = `
      <span class="offline-status-dot"></span>
      <strong>${offline ? 'Working offline' : attention ? 'Sync needs review' : syncing ? 'Syncing…' : queued > 0 ? 'Ready to sync' : 'Online & synced'}</strong>
      <small>${queued > 0 ? `${queued} change${queued === 1 ? '' : 's'} saved safely` : lastSyncCopy}</small>
      ${offline ? '' : '<button type="button" class="offline-sync-button" id="sync-now-btn">Sync now</button>'}
    `;
    document.getElementById('sync-now-btn')?.addEventListener('click', () => attemptSync({ manual: true }));
  }
  renderOfflineStatus();
  window.addEventListener('online', renderOfflineStatus);
  window.addEventListener('offline', renderOfflineStatus);
  window.addEventListener('offline-queue-updated', renderOfflineStatus);
  window.addEventListener('sync-status-changed', (event) => {
    currentSyncState = event.detail?.status || 'idle';
    renderOfflineStatus();
  });

  // Mobile menu + overlay
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    mobileBtn.setAttribute('aria-expanded', 'true');
    mobileBtn.setAttribute('aria-label', 'Close navigation menu');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    mobileBtn.setAttribute('aria-expanded', 'false');
    mobileBtn.setAttribute('aria-label', 'Open navigation menu');
  }

  mobileBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  // Close sidebar when tapping overlay
  overlay.addEventListener('click', closeSidebar);

  // Auto-close sidebar when navigating (on mobile)
  sidebar.querySelectorAll('.nav-item[data-page]').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        closeSidebar();
      }
    });
  });

  // Handle resize: close sidebar if expanding to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
      closeSidebar();
    }
  });

  return document.getElementById('page-content');
}
