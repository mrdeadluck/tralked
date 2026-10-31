/**
 * 60 requests per minute per API key, in a fixed one-minute window.
 *
 * Limitation: the counters live in this process's memory. With several server instances
 * (serverless, horizontal scaling) each instance counts on its own, so the effective limit is
 * 60 × instances. Moving the counter to Postgres or Redis keeps this interface.
 */

export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;

type Window = { start: number; count: number };

const windows = new Map<string, Window>();

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
};

export function consumeRateLimit(keyId: string, now = Date.now()): RateLimitResult {
  let window = windows.get(keyId);
  if (!window || now - window.start >= RATE_WINDOW_MS) {
    window = { start: now, count: 0 };
    windows.set(keyId, window);
  }
  const resetSeconds = Math.max(1, Math.ceil((window.start + RATE_WINDOW_MS - now) / 1000));
  if (window.count >= RATE_LIMIT) {
    return { ok: false, limit: RATE_LIMIT, remaining: 0, resetSeconds };
  }
  window.count += 1;
  return { ok: true, limit: RATE_LIMIT, remaining: RATE_LIMIT - window.count, resetSeconds };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetSeconds),
  };
  if (!result.ok) headers["Retry-After"] = String(result.resetSeconds);
  return headers;
}

/** Tests only. */
export function resetRateLimits() {
  windows.clear();
}
