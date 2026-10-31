/**
 * Fixed-window attempt counters for the login, sign-up and password-reset forms.
 *
 * Same limitation as the robots' API limit (lib/api/rate-limit.ts): the counters live in this
 * process's memory, so with several server instances each one counts on its own.
 */

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number };

type Window = { start: number; count: number };

export type Limiter = {
  /** Counts one attempt for `key` and says whether it is allowed. */
  hit(key: string, now?: number): LimitResult;
  /** Whether one more attempt would be allowed, without counting it. */
  check(key: string, now?: number): LimitResult;
  reset(key: string): void;
  /** Tests only. */
  size(): number;
  /** Tests only. */
  clear(): void;
};

export function createLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  /** Past this many tracked keys, expired windows are swept on the next new key. */
  maxKeys?: number;
}): Limiter {
  const windows = new Map<string, Window>();

  const current = (key: string, now: number): Window | undefined => {
    const window = windows.get(key);
    if (window && now - window.start < windowMs) return window;
    if (window) windows.delete(key);
    return undefined;
  };

  const sweep = (now: number) => {
    for (const [key, window] of windows) if (now - window.start >= windowMs) windows.delete(key);
  };

  const refused = (window: Window, now: number): LimitResult => ({
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil((window.start + windowMs - now) / 1000)),
  });

  return {
    hit(key, now = Date.now()) {
      let window = current(key, now);
      if (!window) {
        if (windows.size >= maxKeys) sweep(now);
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= limit) return refused(window, now);
      window.count += 1;
      return { ok: true };
    },
    check(key, now = Date.now()) {
      const window = current(key, now);
      return window && window.count >= limit ? refused(window, now) : { ok: true };
    },
    reset(key) {
      windows.delete(key);
    },
    size: () => windows.size,
    clear: () => windows.clear(),
  };
}

const MINUTE = 60_000;

/** Login: every attempt per IP; only failed attempts per e-mail (a success clears it). */
export const loginIpLimiter = createLimiter({ limit: 30, windowMs: 15 * MINUTE });
export const loginEmailLimiter = createLimiter({ limit: 5, windowMs: 15 * MINUTE });
/** Sign-ups per IP. */
export const signupIpLimiter = createLimiter({ limit: 5, windowMs: 60 * MINUTE });
/** "Esqueci a senha" requests per IP and per e-mail (each one may print a link). */
export const resetIpLimiter = createLimiter({ limit: 10, windowMs: 15 * MINUTE });
export const resetEmailLimiter = createLimiter({ limit: 3, windowMs: 60 * MINUTE });

/**
 * E-mail confirmation links (sign-up welcome, e-mail change, "Reenviar"): per account, and per
 * recipient address, so toggling the e-mail between two addresses cannot mail strangers without
 * end nor burn the provider's daily quota (which would stop password resets).
 */
export const confirmationAccountLimiter = createLimiter({ limit: 3, windowMs: 60 * MINUTE });
export const confirmationRecipientLimiter = createLimiter({ limit: 3, windowMs: 24 * 60 * MINUTE });

/**
 * Takes one confirmation e-mail slot for the account and the recipient. Nothing is counted
 * when either is over its limit (the refusal says how long to wait).
 */
export function takeConfirmationSlot(userId: string | null, recipient: string, now: number = Date.now()): LimitResult {
  const byRecipient = confirmationRecipientLimiter.check(recipient, now);
  if (!byRecipient.ok) return byRecipient;
  if (userId) {
    const byAccount = confirmationAccountLimiter.check(userId, now);
    if (!byAccount.ok) return byAccount;
    confirmationAccountLimiter.hit(userId, now);
  }
  return confirmationRecipientLimiter.hit(recipient, now);
}

/** Tests only: forgets every counter. */
export function resetAuthLimits(): void {
  for (const limiter of [
    loginIpLimiter,
    loginEmailLimiter,
    signupIpLimiter,
    resetIpLimiter,
    resetEmailLimiter,
    confirmationAccountLimiter,
    confirmationRecipientLimiter,
  ]) {
    limiter.clear();
  }
}
