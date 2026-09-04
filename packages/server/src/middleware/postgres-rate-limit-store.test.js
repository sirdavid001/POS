import { jest } from '@jest/globals';
import { PostgresRateLimitStore } from './postgres-rate-limit-store.js';

describe('PostgresRateLimitStore', () => {
  test('returns the shared hit count and reset time from PostgreSQL', async () => {
    const resetAt = new Date('2026-09-04T12:00:00.000Z');
    const execute = jest.fn().mockResolvedValue({
      rows: [{ hits: '3', reset_at: resetAt }],
    });
    const store = new PostgresRateLimitStore('auth', execute);
    store.init({ windowMs: 15_000 });

    await expect(store.increment('203.0.113.10')).resolves.toEqual({
      totalHits: 3,
      resetTime: resetAt,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (scope, client_key)'),
      ['auth', expect.stringMatching(/^[a-f0-9]{64}$/), 15_000]
    );
  });

  test('uses separate scopes and never stores raw client identifiers', async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresRateLimitStore('api', execute);

    await store.resetKey('sensitive-client-key');
    await store.resetAll();

    expect(execute.mock.calls[0][1]).toEqual([
      'api',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(execute.mock.calls[0][1][1]).not.toContain('sensitive-client-key');
    expect(execute.mock.calls[1][1]).toEqual(['api']);
  });
});
