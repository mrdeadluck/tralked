import { dbFailureKind, describeError } from "./errors";

/**
 * Keeps a background worker going when the database connection drops (Neon suspending or waking
 * the compute, a network blip): the unit of work that hit the failure waits, with growing pauses,
 * until the database answers a probe again and then runs again. The pool (pg via @prisma/adapter-pg)
 * drops broken connections by itself, so the retry runs on a fresh one. Gives up, with
 * DatabaseUnavailableError, after `attempts` failures in a row without the unit getting through,
 * or at once when Neon refuses the compute (quota spent): waiting would not help.
 */

export class DatabaseUnavailableError extends Error {
  override name = "DatabaseUnavailableError";
  constructor(
    message: string,
    readonly reason: "connection" | "quota",
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type DbRetryLog = { info(message: string): void; warn(message: string): void };

export type DbRetryOptions = {
  log: DbRetryLog;
  /** Failures in a row (unit or probe) before giving up. */
  attempts?: number;
  /** First pause; doubles each time up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Cheap query that tells whether the database is back (default: `SELECT 1`). */
  probe?: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
};

/** About 4 minutes of waiting in all (5 + 10 + 20 + 40 + 60 + 60 + 60 s), longer than a Neon wake-up. */
export const DB_RETRY_DEFAULTS = { attempts: 7, baseDelayMs: 5_000, maxDelayMs: 60_000 } as const;

const defaultProbe = async () => {
  const { prisma } = await import("@/lib/db");
  await prisma.$queryRaw`SELECT 1`;
};

export type WithDb = <T>(label: string, unit: () => Promise<T>) => Promise<T>;

/** Pause before the `failure`-th retry (1-based). */
export function retryDelay(failure: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, failure - 1));
}

/**
 * `withDb(label, unit)` runs `unit` and, when it fails because the database went away, waits and
 * runs it again (any other error goes straight up). A unit should be one step a worker can repeat
 * safely: one batch, one slice, one loop turn (the syncs are resumable and idempotent).
 */
export function createDbRetry(options: DbRetryOptions): WithDb {
  const {
    log,
    attempts = DB_RETRY_DEFAULTS.attempts,
    baseDelayMs = DB_RETRY_DEFAULTS.baseDelayMs,
    maxDelayMs = DB_RETRY_DEFAULTS.maxDelayMs,
    probe = defaultProbe,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;

  return async function withDb<T>(label: string, unit: () => Promise<T>): Promise<T> {
    let failures = 0;
    for (;;) {
      try {
        return await unit();
      } catch (error) {
        let last: unknown = error;
        let kind = dbFailureKind(last);
        if (kind === null) throw error;
        // Wait until a probe gets through, then run the unit again.
        for (;;) {
          if (kind === "quota") {
            throw new DatabaseUnavailableError(
              `${label}: Neon refused the database (quota or disabled endpoint): stopping until the next run`,
              "quota",
              { cause: last },
            );
          }
          failures++;
          if (failures > attempts) {
            throw new DatabaseUnavailableError(
              `${label}: database still unreachable after ${attempts} attempts: stopping until the next run`,
              "connection",
              { cause: last },
            );
          }
          const delay = retryDelay(failures, baseDelayMs, maxDelayMs);
          log.warn(
            `${label}: database connection lost, retry ${failures}/${attempts} in ${Math.round(delay / 1000)} s. ` +
              describeError(last, { stack: false }).replace(/\n\s*/g, " ← "),
          );
          await sleep(delay);
          try {
            await probe();
            break;
          } catch (probeError) {
            kind = dbFailureKind(probeError);
            if (kind === null) throw probeError;
            last = probeError;
          }
        }
        log.info(`${label}: database back, carrying on`);
      }
    }
  };
}
