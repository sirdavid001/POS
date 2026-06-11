// Simple hash-based SPA router

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

    // Redirect to login if not authenticated
    if (!user && !publicRoutes.has(hash)) {
      window.location.hash = '#/login';
      return;
    }

    // Redirect to dashboard if already logged in and trying to access login
    if (user && ['/login', '/forgot-password'].includes(hash)) {
      window.location.hash = '#/dashboard';
      return;
    }

    // Find matching route
    const handler = this.routes[hash];
    if (handler) {
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
