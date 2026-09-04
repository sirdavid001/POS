import { jest } from '@jest/globals';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  createRefreshToken,
  hashRefreshToken,
  isWebsiteClient,
  refreshExpiryMilliseconds,
  refreshTokenCandidates,
  refreshTokenFromRequest,
  setRefreshCookie,
} from './refresh-token.js';

describe('refresh token helpers', () => {
  test('creates high-entropy opaque tokens and stores only their hash', () => {
    const first = createRefreshToken();
    const second = createRefreshToken();

    expect(first).toMatch(/^[a-f0-9]{128}$/);
    expect(second).not.toBe(first);
    expect(hashRefreshToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(refreshTokenCandidates(first)).toEqual([hashRefreshToken(first), first]);
  });

  test('reads request bodies before cookies and handles encoded cookie values', () => {
    expect(refreshTokenFromRequest({
      body: { refreshToken: 'body-token' },
      headers: { cookie: `${REFRESH_COOKIE_NAME}=cookie-token` },
    })).toBe('body-token');

    expect(refreshTokenFromRequest({
      body: {},
      headers: { cookie: `other=x; ${REFRESH_COOKIE_NAME}=encoded%20token` },
    })).toBe('encoded token');
  });

  test('recognizes only browser clients with a non-opaque origin', () => {
    const request = (origin) => ({
      get: (name) => name === 'x-quickpos-client' ? 'website' : origin,
    });

    expect(isWebsiteClient(request('https://quickpos.com.ng'))).toBe(true);
    expect(isWebsiteClient(request('null'))).toBe(false);
    expect(isWebsiteClient(request(undefined))).toBe(false);
  });

  test('sets and clears a production HttpOnly refresh cookie', () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    const config = {
      nodeEnv: 'production',
      jwt: { refreshExpiry: '2h' },
    };

    setRefreshCookie(res, 'raw-token', config);
    clearRefreshCookie(res, config);

    expect(refreshExpiryMilliseconds('2h')).toBe(7_200_000);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'raw-token', {
      httpOnly: true,
      maxAge: 7_200_000,
      path: '/api/v1/auth',
      sameSite: 'none',
      secure: true,
    });
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      path: '/api/v1/auth',
      sameSite: 'none',
      secure: true,
    });
  });
});
