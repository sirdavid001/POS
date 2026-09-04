import crypto from 'node:crypto';
import { query } from '../config/database.js';

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

export class PostgresRateLimitStore {
  constructor(scope, execute = query) {
    this.scope = scope;
    this.execute = execute;
    this.windowMs = 60_000;
    this.localKeys = false;
    this.prefix = `quickpos:${scope}:`;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const result = await this.execute(
      `WITH cleanup AS (
         DELETE FROM api_rate_limits
         WHERE reset_at < NOW() - INTERVAL '1 day'
       )
       INSERT INTO api_rate_limits (scope, client_key, hits, reset_at)
       VALUES ($1, $2, 1, NOW() + ($3::double precision * INTERVAL '1 millisecond'))
       ON CONFLICT (scope, client_key) DO UPDATE SET
         hits = CASE
           WHEN api_rate_limits.reset_at <= NOW() THEN 1
           ELSE api_rate_limits.hits + 1
         END,
         reset_at = CASE
           WHEN api_rate_limits.reset_at <= NOW()
             THEN NOW() + ($3::double precision * INTERVAL '1 millisecond')
           ELSE api_rate_limits.reset_at
         END
       RETURNING hits, reset_at`,
      [this.scope, hashKey(key), this.windowMs]
    );

    return {
      totalHits: Number(result.rows[0].hits),
      resetTime: new Date(result.rows[0].reset_at),
    };
  }

  async decrement(key) {
    await this.execute(
      `UPDATE api_rate_limits
       SET hits = GREATEST(hits - 1, 0)
       WHERE scope = $1 AND client_key = $2 AND reset_at > NOW()`,
      [this.scope, hashKey(key)]
    );
  }

  async resetKey(key) {
    await this.execute(
      'DELETE FROM api_rate_limits WHERE scope = $1 AND client_key = $2',
      [this.scope, hashKey(key)]
    );
  }

  async resetAll() {
    await this.execute('DELETE FROM api_rate_limits WHERE scope = $1', [this.scope]);
  }
}
