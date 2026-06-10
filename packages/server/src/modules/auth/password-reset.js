import crypto from 'node:crypto';

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function buildPasswordResetUrl(baseUrl, token) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}
