import crypto from 'node:crypto';

export const REFRESH_COOKIE_NAME = 'quickpos_refresh';

export function createRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function refreshTokenCandidates(token) {
  if (!token) return [];
  return [...new Set([hashRefreshToken(token), String(token)])];
}

export function refreshExpiryMilliseconds(value = '7d') {
  const match = String(value).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const units = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * units[match[2].toLowerCase()];
}

function cookiesFromRequest(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator === -1) return cookies;
      const name = part.slice(0, separator);
      const value = part.slice(separator + 1);
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

export function refreshTokenFromRequest(req) {
  return req.body?.refreshToken || cookiesFromRequest(req)[REFRESH_COOKIE_NAME] || null;
}

export function isWebsiteClient(req) {
  const origin = req.get('origin');
  return req.get('x-quickpos-client') === 'website' && Boolean(origin) && origin !== 'null';
}

function cookieOptions(config) {
  const production = config.nodeEnv === 'production';
  return {
    httpOnly: true,
    maxAge: refreshExpiryMilliseconds(config.jwt.refreshExpiry),
    path: '/api/v1/auth',
    sameSite: production ? 'none' : 'lax',
    secure: production,
  };
}

export function setRefreshCookie(res, token, config) {
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions(config));
}

export function clearRefreshCookie(res, config) {
  const { maxAge: _maxAge, ...options } = cookieOptions(config);
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}
