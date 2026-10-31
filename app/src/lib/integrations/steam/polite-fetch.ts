import { timeoutSignal } from "../http";

/** Identifies Tralked to Steam, the Steam CDN and SteamSpy (public endpoints, no key). */
export const TRALKED_USER_AGENT = "TralkedBot/0.1 (contato: dev)";
/** Minimum gap between two requests to the same host. */
export const DEFAULT_MIN_INTERVAL_MS = 1_200;

export type PoliteFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type PoliteFetchOptions = {
  /** Minimum gap between request starts per host (default 1.2 s). */
  minIntervalMs?: number;
  /** Per-host overrides of `minIntervalMs` (e.g. the store's tighter limit). */
  hostIntervalsMs?: Record<string, number>;
  userAgent?: string;
  /** Retries after a 429/5xx or a network error (default 4). */
  retries?: number;
  /** First backoff; doubles on every retry unless the host sends `Retry-After` (default 5 s). */
  backoffMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { url: string; attempt: number; waitMs: number; reason: string }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryable = (status: number) => status === 429 || status >= 500;

/** Seconds (or an HTTP date) from `Retry-After`, capped at two minutes. */
function retryAfterMs(res: Response, now: number): number | undefined {
  const value = res.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 120_000) : undefined;
}

/**
 * A `fetch` that behaves well towards public endpoints: at most one request per host every
 * `minIntervalMs` (slots are reserved synchronously, so concurrent callers queue up), a
 * descriptive User-Agent, and retries with exponential backoff on 429/5xx and network errors.
 * After the last retry the final response is returned (or the network error thrown).
 */
export function createPoliteFetch(options: PoliteFetchOptions = {}): PoliteFetch {
  const {
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    hostIntervalsMs = {},
    userAgent = TRALKED_USER_AGENT,
    retries = 4,
    backoffMs = 5_000,
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    now = Date.now,
    onRetry,
  } = options;
  const nextSlot = new Map<string, number>();

  async function waitForSlot(host: string) {
    const interval = hostIntervalsMs[host] ?? minIntervalMs;
    const current = now();
    const slot = Math.max(current, nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + interval);
    if (slot > current) await sleep(slot - current);
  }

  return async function politeFetch(url, init = {}) {
    const host = new URL(url).host;
    const headers = new Headers(init.headers);
    headers.set("User-Agent", userAgent);

    for (let attempt = 0; ; attempt++) {
      await waitForSlot(host);
      let res: Response | undefined;
      let error: unknown;
      try {
        res = await fetchImpl(url, { ...init, headers, signal: init.signal ?? timeoutSignal() });
      } catch (caught) {
        error = caught;
      }
      if (res && !isRetryable(res.status)) return res;
      if (attempt >= retries) {
        if (res) return res;
        throw error;
      }
      const waitMs = (res && retryAfterMs(res, now())) ?? backoffMs * 2 ** attempt;
      const reason = res ? `HTTP ${res.status}` : String(error);
      onRetry?.({ url, attempt: attempt + 1, waitMs, reason });
      // Drain the body so the connection is released while we wait.
      await res?.body?.cancel().catch(() => undefined);
      await sleep(waitMs);
    }
  };
}
