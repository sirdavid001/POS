export const PRODUCTION_API_BASE = 'https://pos-server-six.vercel.app/api/v1';

export function resolveApiBase(rawValue, { development = false } = {}) {
  const fallback = development ? '/api/v1' : PRODUCTION_API_BASE;
  const value = rawValue?.trim();
  if (!value) return fallback;
  if (value.startsWith('/')) return value;

  let normalized = value;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const url = new URL(normalized);
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/api/v1';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}
