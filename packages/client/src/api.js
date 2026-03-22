// API client with JWT refresh support
// In production, VITE_API_URL points to the deployed backend (e.g. https://pos-api.vercel.app/api/v1)
// In dev, Vite proxy forwards /api/v1 to localhost:3001
const API_BASE = import.meta.env.VITE_API_URL?.trim() || '/api/v1';

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

    if (!response.ok) {
      throw new Error(json.error || 'Request failed');
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
      return true;
    } catch {
      return false;
    }
  }

  get(path) { return this.request('GET', path); }
  post(path, data) { return this.request('POST', path, data); }
  patch(path, data) { return this.request('PATCH', path, data); }
  delete(path) { return this.request('DELETE', path); }
}

export const api = new ApiClient();
