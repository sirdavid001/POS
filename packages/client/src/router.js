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

    const hash = window.location.hash.slice(1) || '/login';
    const user = localStorage.getItem('user');

    // Redirect to login if not authenticated
    if (!user && hash !== '/login' && hash !== '/register') {
      window.location.hash = '#/login';
      return;
    }

    // Redirect to dashboard if already logged in and trying to access login
    if (user && (hash === '/login' || hash === '/register')) {
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
