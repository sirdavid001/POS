// API client with JWT refresh support
import { clearSubscription, saveSubscription } from './entitlement.js';
import { resolveApiBase } from '../../shared/src/api.js';

// Development uses Vite's local proxy. Production always falls back to the
// shared QuickPOS API so web, desktop, and mobile clients use one database.
const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, {
  development: import.meta.env.DEV,
});

export class ApiError extends Error {
  constructor(message, response, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = response.status;
    this.code = details.code;
    this.details = details;
  }
}

class ApiClient {
  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    clearSubscription();
  }

  async request(method, path, data = null, options = {}) {
    const url = `${API_BASE}${path}`;
    const config = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    if (this.accessToken) {
      config.headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }

    let response = await fetch(url, config);

    // Auto-refresh on 401
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        config.headers['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url, config);
      } else {
        this.clearTokens();
        window.location.hash = '#/login';
        throw new Error('Session expired. Please log in again.');
      }
    }

    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error(`Server returned an invalid response (HTTP ${response.status}). Please check your connection.`);
    }

    if (json.subscription) {
      saveSubscription(json.subscription);
    }

    if (!response.ok) {
      if (json.code === 'SUBSCRIPTION_EXPIRED') {
        window.dispatchEvent(new CustomEvent('subscription-expired', { detail: json.subscription }));
      }
      throw new ApiError(json.error || 'Request failed', response, json);
    }

    return json;
  }

  async refreshAccessToken() {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.accessToken = data.accessToken;
      localStorage.setItem('accessToken', data.accessToken);
      if (data.subscription) saveSubscription(data.subscription);
      return true;
    } catch {
      return false;
    }
  }

  async download(path) {
    const url = `${API_BASE}${path}`;
    const config = {
      headers: {},
    };

    if (this.accessToken) {
      config.headers.Authorization = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(url, config);

    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
        response = await fetch(url, config);
      } else {
        this.clearTokens();
        window.location.hash = '#/login';
        throw new Error('Session expired. Please log in again.');
      }
    }

    if (!response.ok) {
      let message = 'Download failed';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch {}
      throw new Error(message);
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

    return {
      blob: await response.blob(),
      filename: filenameMatch?.[1] || null,
    };
  }

  get(path) { return this.request('GET', path); }
  post(path, data) { return this.request('POST', path, data); }
  patch(path, data) { return this.request('PATCH', path, data); }
  delete(path) { return this.request('DELETE', path); }
}

export const api = new ApiClient();
