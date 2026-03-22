import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { attemptSync } from './sync.js';
import { router } from './router.js';
import { renderLoginPage, renderRegisterPage } from './pages/auth.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderPOS } from './pages/pos.js';
import { renderProducts } from './pages/products.js';
import { renderOrders } from './pages/orders.js';
import { renderInventory } from './pages/inventory.js';
import { renderCustomers } from './pages/customers.js';
import { renderReports } from './pages/reports.js';
import { renderSettings } from './pages/settings.js';

// Setup PWA Service Worker
const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New content available, ready to update.');
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
});

// Register routes
router.addRoute('/login', renderLoginPage);
router.addRoute('/register', renderRegisterPage);
router.addRoute('/dashboard', renderDashboard);
router.addRoute('/pos', renderPOS);
router.addRoute('/products', renderProducts);
router.addRoute('/orders', renderOrders);
router.addRoute('/inventory', renderInventory);
router.addRoute('/customers', renderCustomers);
router.addRoute('/reports', renderReports);
router.addRoute('/settings', renderSettings);

// Start the app
router.start();

// WebSocket connection for real-time updates
function getWebSocketUrl() {
  const configuredUrl = import.meta.env.VITE_WS_URL?.trim();
  if (configuredUrl) return configuredUrl;
  if (!import.meta.env.DEV) return null;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function connectWebSocket() {
  const wsUrl = getWebSocketUrl();
  if (!wsUrl) return;

  try {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { event: eventName, data } = payload;
        window.dispatchEvent(new CustomEvent('ws-message', { detail: payload }));
      } catch {}
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 5s...');
      setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch {
    setTimeout(connectWebSocket, 5000);
  }
}

// Only connect WS if user is logged in
if (localStorage.getItem('user')) {
  connectWebSocket();
}

window.addEventListener('online', attemptSync);
document.addEventListener('DOMContentLoaded', attemptSync);
setTimeout(attemptSync, 2000); // Trigger a sync briefly after app load
