import { api } from '../api.js';
import { icons } from '../utils.js';

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
    { id: 'orders', label: 'Orders', icon: icons.orders, hash: '#/orders', roles: ['admin', 'manager', 'cashier'] },
    { id: 'reports', label: 'Reports', icon: icons.reports, hash: '#/reports', roles: ['admin', 'manager'] },
    { id: 'settings', label: 'Settings', icon: icons.settings, hash: '#/settings', roles: ['admin'] },
  ];

  const visibleNav = navItems.filter(item => item.roles.includes(user.role));

  app.innerHTML = `
    <div class="app-layout">
      <!-- Mobile menu button -->
      <button id="mobile-menu-btn" class="btn btn-ghost" style="position:fixed;top:1rem;left:1rem;z-index:60;display:none;padding:0.5rem;">
        ${icons.menu}
      </button>

      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <h1>⚡ QuickPOS</h1>
          <p>${user.name || 'User'} · ${(user.role || 'cashier').charAt(0).toUpperCase() + (user.role || '').slice(1)}</p>
        </div>
        <nav class="sidebar-nav">
          ${visibleNav.map(item => `
            <a href="${item.hash}" class="nav-item ${activePage === item.id ? 'active' : ''}" data-page="${item.id}">
              ${item.icon}
              <span>${item.label}</span>
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          <button id="logout-btn" class="nav-item" style="color:var(--color-danger);">
            ${icons.logout}
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main class="main-content" id="page-content">
        <div style="display:flex;align-items:center;justify-content:center;height:60vh;">
          <div class="spinner spinner-lg"></div>
        </div>
      </main>
    </div>
  `;

  // Logout handler
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.post('/auth/logout', { refreshToken: api.refreshToken });
    } catch {}
    api.clearTokens();
    window.location.hash = '#/login';
  });

  // Mobile menu
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');

  function checkMobile() {
    if (window.innerWidth <= 1024) {
      mobileBtn.style.display = 'flex';
    } else {
      mobileBtn.style.display = 'none';
      sidebar.classList.remove('open');
    }
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);

  mobileBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  return document.getElementById('page-content');
}
