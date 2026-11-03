/**
 * The HTTP core shared by the Tralked API clients (news robot and guide robot): bearer key, retry with
 * backoff on 429/5xx/network failures, `TralkedError` for everything else.
 */

export type ApiIssue = { path: string; message: string };

export class TralkedError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[];

  constructor(status: number, code: string, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "TralkedError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;
const RETRY_AFTER_CAP_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After` as milliseconds (delta-seconds or HTTP date), or null when absent or unreadable. */
function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.min(Number(value) * 1000, RETRY_AFTER_CAP_MS);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), RETRY_AFTER_CAP_MS);
}

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

async function errorFrom(response: Response): Promise<TralkedError> {
  let code = "unknown";
  let message = `HTTP ${response.status}`;
  let issues: ApiIssue[] = [];
  try {
    const parsed = (await response.json()) as { error?: { code?: string; message?: string; issues?: ApiIssue[] } };
    if (parsed.error) {
      code = parsed.error.code ?? code;
      message = parsed.error.message ?? message;
      issues = Array.isArray(parsed.error.issues) ? parsed.error.issues : [];
    }
  } catch {
    // Not a JSON error body (a proxy page, say): keep the status only.
  }
  return new TralkedError(response.status, code, message, issues);
}

export type CallInit = {
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as is, with this Content-Type (an image upload). Wins over `body`. */
  raw?: { bytes: Uint8Array; contentType: string };
  idempotencyKey?: string;
};

export type Call = (method: string, path: string, init?: CallInit) => Promise<Response>;

export function createCall(options: { baseUrl: string; key: string; fetchFn?: typeof fetch }): Call {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? fetch;

  /** One logical request: 429, 5xx and network failures are retried; other failures throw. */
  return async function call(method, path, init = {}) {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.key}`, Accept: "application/json" };
    let body: BodyInit | undefined;
    if (init.raw) {
      headers["Content-Type"] = init.raw.contentType;
      body = init.raw.bytes as BodyInit;
    } else if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    if (init.idempotencyKey !== undefined) headers["Idempotency-Key"] = init.idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null;
      let failure: unknown = null;
      try {
        response = await fetchFn(`${baseUrl}${path}`, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        failure = error;
      }

      if (response?.ok) return response;
      const retryable = response === null || isRetryableStatus(response.status);
      if (!retryable || attempt >= MAX_RETRIES) {
        if (response === null) {
          const reason = failure instanceof Error ? failure.message : String(failure);
          throw new TralkedError(0, "network_error", `Falha de rede em ${method} ${path}: ${reason}`);
        }
        throw await errorFrom(response);
      }
      const wait = (response && retryAfterMs(response.headers.get("Retry-After"))) ?? BACKOFF_BASE_MS * 2 ** attempt;
      await sleep(wait);
    }
  };
}
