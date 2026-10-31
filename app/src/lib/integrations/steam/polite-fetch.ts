import { timeoutSignal } from "../http";

/** Identifies Tralked to Steam, the Steam CDN and SteamSpy (public endpoints, no key). */
export const TRALKED_USER_AGENT = "TralkedBot/0.1 (contato: dev)";
/** Minimum gap between two requests to the same host. */
export const DEFAULT_MIN_INTERVAL_MS = 1_200;
/** No answer from these endpoints is anywhere near this big; anything larger is refused. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** The public endpoints Tralked reads without a key. */
export const STEAM_API_HOSTS = new Set([
  "steamcommunity.com",
  "store.steampowered.com",
  "api.steampowered.com",
  "steamspy.com",
]);

/** An https URL on Steam's CDN (`*.steamstatic.com`): the only media Tralked hotlinks. */
export function isSteamCdnUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".steamstatic.com") && !parsed.port;
  } catch {
    return false;
  }
}

/** Requests (and redirects) only ever go to the Steam/SteamSpy endpoints or the Steam CDN, over https. */
export function isAllowedSteamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (STEAM_API_HOSTS.has(parsed.hostname) || isSteamCdnUrl(url));
  } catch {
    return false;
  }
}

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
const isRedirect = (status: number) => status >= 300 && status < 400;

/** Seconds (or an HTTP date) from `Retry-After`, capped at two minutes. */
function retryAfterMs(res: Response, now: number): number | undefined {
  const value = res.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 120_000) : undefined;
}

/** The body as text, refusing anything over `maxBytes` (declared or actually streamed). */
export async function readText(res: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Response too large (${declared} bytes) from ${res.url || "Steam"}`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Response too large (over ${maxBytes} bytes) from ${res.url || "Steam"}`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJson<T>(res: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<T> {
  return JSON.parse(await readText(res, maxBytes)) as T;
}

/**
 * A `fetch` that behaves well towards public endpoints:
 * - at most one request per host every `minIntervalMs` (slots are reserved synchronously, so
 *   concurrent callers queue up);
 * - on 429/5xx the whole host backs off (`Retry-After` or exponential backoff), so every queued
 *   caller waits, not just the one that was refused; the request is retried, and after the last
 *   retry the final response is returned (or the network error thrown);
 * - a descriptive User-Agent;
 * - only https requests to the Steam/SteamSpy endpoints and the Steam CDN; redirects are followed
 *   by hand and only to those hosts (a redirect elsewhere comes back as the 3xx response).
 *   Callers that pass `redirect: "manual"` get every redirect response as is.
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
  /** Host refused us (429/5xx): nobody calls it before this time. */
  const blockedUntil = new Map<string, number>();

  async function waitForSlot(host: string) {
    for (;;) {
      const interval = hostIntervalsMs[host] ?? minIntervalMs;
      const current = now();
      const slot = Math.max(current, nextSlot.get(host) ?? 0, blockedUntil.get(host) ?? 0);
      nextSlot.set(host, slot + interval);
      if (slot > current) await sleep(slot - current);
      // A refusal that arrived while we slept pushes us back too.
      if ((blockedUntil.get(host) ?? 0) <= now()) return;
    }
  }

  async function request(url: string, init: RequestInit, hops: number): Promise<Response> {
    if (!isAllowedSteamUrl(url)) throw new Error(`Refusing to fetch ${url}: not a Steam endpoint over https`);
    const host = new URL(url).host;
    const headers = new Headers(init.headers);
    headers.set("User-Agent", userAgent);
    const manual = init.redirect === "manual";

    for (let attempt = 0; ; attempt++) {
      await waitForSlot(host);
      let res: Response | undefined;
      let error: unknown;
      try {
        res = await fetchImpl(url, { ...init, headers, redirect: "manual", signal: init.signal ?? timeoutSignal() });
      } catch (caught) {
        error = caught;
      }
      if (res && isRedirect(res.status) && !manual) {
        const location = res.headers.get("location");
        const target = location ? new URL(location, url).toString() : null;
        if (!target || hops >= MAX_REDIRECTS || !isAllowedSteamUrl(target)) return res;
        await res.body?.cancel().catch(() => undefined);
        return request(target, init, hops + 1);
      }
      if (res && !isRetryable(res.status)) return res;
      if (attempt >= retries) {
        if (res) return res;
        throw error;
      }
      const waitMs = (res && retryAfterMs(res, now())) ?? backoffMs * 2 ** attempt;
      if (res) blockedUntil.set(host, Math.max(blockedUntil.get(host) ?? 0, now() + waitMs));
      const reason = res ? `HTTP ${res.status}` : String(error);
      onRetry?.({ url, attempt: attempt + 1, waitMs, reason });
      // Drain the body so the connection is released while we wait.
      await res?.body?.cancel().catch(() => undefined);
      // A refused host is waited for in waitForSlot; a network error only delays this caller.
      if (!res) await sleep(waitMs);
    }
  }

  return (url, init = {}) => request(url, init, 0);
}
