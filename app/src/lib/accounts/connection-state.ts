import type { LinkedAccountView } from "./queries";

/** An import attempt older than this without a newer success counts as failed. */
export const IMPORT_GRACE_MS = 10 * 60_000;

export type ConnectionState =
  | { kind: "disconnected"; /** Handle of a link whose code expired, to prefill the form. */ expiredHandle: string | null }
  | { kind: "pending"; handle: string; code: string; expiresAt: Date }
  | {
      kind: "connected";
      handle: string;
      lastSyncedAt: Date | null;
      /** An import is running (or queued right after the confirmation). */
      importing: boolean;
      /** The latest import did not finish (private profile or platform unavailable). */
      failed: boolean;
    };

/**
 * State of one platform card on /conta/conexoes. Only verified accounts count as connected; a
 * pending row is "pending" while its code is valid and "disconnected" (expired) afterwards.
 */
export function connectionState(view: LinkedAccountView | undefined, now: Date = new Date()): ConnectionState {
  if (!view) return { kind: "disconnected", expiredHandle: null };
  if (!view.verified) {
    if (view.pendingCode && view.codeExpiresAt) {
      return { kind: "pending", handle: view.handle, code: view.pendingCode, expiresAt: view.codeExpiresAt };
    }
    return { kind: "disconnected", expiredHandle: view.handle };
  }
  const attempt = view.lastSyncAttemptAt;
  const synced = view.lastSyncedAt;
  const unfinished = attempt !== null && (synced === null || attempt > synced);
  const recent = attempt !== null && now.getTime() - attempt.getTime() < IMPORT_GRACE_MS;
  return {
    kind: "connected",
    handle: view.handle,
    lastSyncedAt: synced,
    // Verified but never attempted: the first import is queued (after() or the cron).
    importing: (unfinished && recent) || (attempt === null && synced === null),
    failed: unfinished && !recent,
  };
}
