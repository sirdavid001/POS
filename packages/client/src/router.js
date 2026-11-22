// Simple hash-based SPA router
import { hasCompletedPermissionSetup } from './permissions.js';
import { closeAllDialogs } from './dialog.js';
import { needsInitialActivation } from './entitlement.js';
import { renderActivationGate } from './pages/activation.js';

class Router {
  constructor() {
    this.routes = {};
    this.currentPage = null;
    window.addEventListener('hashchange', () => this.navigate());
  }

  addRoute(path, handler) {
    this.routes[path] = handler;
  }

  navigate(path) {
    if (path) {
      window.location.hash = path;
      return;
    }

    const rawHash = window.location.hash.slice(1) || '/login';
    const hash = rawHash.split('?')[0];
    const user = localStorage.getItem('user');
    const publicRoutes = new Set(['/login', '/forgot-password', '/reset-password']);
    const roleAccess = {
      '/products': ['admin', 'manager'],
      '/inventory': ['admin', 'manager'],
      '/orders': ['admin', 'manager'],
      '/reports': ['admin', 'manager'],
      '/settings': ['admin', 'manager'],
    };

    // Redirect to login if not authenticated
    if (!user && !publicRoutes.has(hash)) {
      window.location.hash = '#/login';
      return;
    }

    // Redirect signed-in users away from sign-in without stranding sign-out on the same hash.
    if (user && ['/login', '/forgot-password'].includes(hash)) {
      window.location.hash = '#/dashboard';
      return;
    }

    // Leave account recovery reachable, but never render a store screen while activation is due.
    if (user && hash !== '/reset-password' && needsInitialActivation()) {
      if (this.currentPage !== 'activation') {
        closeAllDialogs();
        this.currentPage = 'activation';
        renderActivationGate(() => this.navigate());
      }
      return;
    }

    if (user && !hasCompletedPermissionSetup() && hash !== '/permissions') {
      window.location.hash = '#/permissions';
      return;
    }

    if (user && hasCompletedPermissionSetup() && hash === '/permissions') {
      window.location.hash = '#/dashboard';
      return;
    }

    if (user && roleAccess[hash]) {
      const role = JSON.parse(user || '{}').role;
      if (!roleAccess[hash].includes(role)) {
        window.location.hash = '#/dashboard';
        return;
      }
    }

    // Find matching route
    const handler = this.routes[hash];
    if (handler) {
      // A dialog belongs to the page that opened it; never carry it onto the next page.
      closeAllDialogs();
      this.currentPage = hash;
      handler();
    } else {
      // 404 - redirect to dashboard
      window.location.hash = user ? '#/dashboard' : '#/login';
    }
  }

  start() {
    this.navigate();
  }
}

export const router = new Router();
