import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { attemptSync } from './sync.js';
import { router } from './router.js';
import { checkForAppUpdate } from './updates.js';
import { api } from './api.js';
import { canAccessInstalledApp, renderInstallRequiredPage } from './installGate.js';

async function startApplication() {
  if (!canAccessInstalledApp()) {
    renderInstallRequiredPage();
    return;
  }

  // Service workers are unavailable when Electron loads the bundled app over file://.
  if (window.location.protocol !== 'file:') {
    registerSW({
      onNeedRefresh() {
        console.log('New content available, ready to update.');
      },
      onOfflineReady() {
        console.log('App ready to work offline');
      },
    });
  }

  // Register routes
  const lazyRoute = (loader, exportName) => () => loader().then((module) => module[exportName]());
  const loadAuth = () => import('./pages/auth.js');
  router.addRoute('/login', lazyRoute(loadAuth, 'renderLoginPage'));
  router.addRoute('/forgot-password', lazyRoute(loadAuth, 'renderForgotPasswordPage'));
  router.addRoute('/reset-password', lazyRoute(loadAuth, 'renderResetPasswordPage'));
  router.addRoute('/dashboard', lazyRoute(() => import('./pages/dashboard.js'), 'renderDashboard'));
  router.addRoute('/pos', lazyRoute(() => import('./pages/pos.js'), 'renderPOS'));
  router.addRoute('/products', lazyRoute(() => import('./pages/products.js'), 'renderProducts'));
  router.addRoute('/orders', lazyRoute(() => import('./pages/orders.js'), 'renderOrders'));
  router.addRoute('/inventory', lazyRoute(() => import('./pages/inventory.js'), 'renderInventory'));
  router.addRoute('/customers', lazyRoute(() => import('./pages/customers.js'), 'renderCustomers'));
  router.addRoute('/reports', lazyRoute(() => import('./pages/reports.js'), 'renderReports'));
  router.addRoute('/settings', lazyRoute(() => import('./pages/settings.js'), 'renderSettings'));
  router.addRoute('/permissions', lazyRoute(() => import('./pages/permissions.js'), 'renderPermissionsPage'));

  if (localStorage.getItem('user')) {
    try {
      await api.get('/auth/me');
    } catch {
      // A previously verified entitlement may still permit limited offline use.
    }
  }
  router.start();

  // Only connect WS if user is logged in
  if (localStorage.getItem('user')) {
    connectWebSocket();
  }

  window.addEventListener('online', () => {
    attemptSync();
    connectWebSocket();
  });
  window.addEventListener('offline', () => {
    clearTimeout(wsReconnectTimer);
    activeWebSocket?.close();
  });
  document.addEventListener('DOMContentLoaded', attemptSync);
  setTimeout(attemptSync, 2000); // Trigger a sync briefly after app load
  setTimeout(checkForAppUpdate, 2500);
}

// WebSocket connection for real-time updates
function getWebSocketUrl() {
  const configuredUrl = import.meta.env.VITE_WS_URL?.trim();
  if (configuredUrl) return configuredUrl;
  if (!import.meta.env.DEV) return null;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

let activeWebSocket = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;

function connectWebSocket() {
  const wsUrl = getWebSocketUrl();
  if (!wsUrl || !navigator.onLine || !localStorage.getItem('user')) return;
  if (activeWebSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(activeWebSocket.readyState)) return;

  try {
    const ws = new WebSocket(wsUrl);
    activeWebSocket = ws;

    ws.onopen = () => {
      wsReconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { event: eventName, data } = payload;
        window.dispatchEvent(new CustomEvent('ws-message', { detail: payload }));
      } catch {}
    };

    ws.onclose = () => {
      activeWebSocket = null;
      if (!navigator.onLine || !localStorage.getItem('user')) return;
      const delay = Math.min(5000 * (2 ** wsReconnectAttempts), 60000);
      wsReconnectAttempts += 1;
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch {
    activeWebSocket = null;
  }
}

startApplication();
