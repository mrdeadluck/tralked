import type { LinkedAccountView, PendingVerification } from "./queries";

/** An import attempt older than this without a newer success counts as failed. */
export const IMPORT_GRACE_MS = 10 * 60_000;

/** A claim waiting for the code to show up in the platform profile. */
export type PendingClaim = { handle: string; code: string; expiresAt: Date };

export type ConnectionState =
  | { kind: "disconnected"; claim: PendingClaim | null }
  | {
      kind: "connected";
      handle: string;
      /** What the field shows (Steam: the SteamID64). */
      value: string;
      /** Ownership proven with a code; typed-in connections are "não verificada". */
      verified: boolean;
      /** "Verificar agora" waiting for its code in the profile (unverified only). */
      verification: PendingVerification | null;
      lastSyncedAt: Date | null;
      /** An import is running (or queued right after the link). */
      importing: boolean;
      /** The latest import did not finish (private profile or platform unavailable). */
      failed: boolean;
    };

/**
 * State of one platform row on /conta/conexoes. Active connections (verified or not) are
 * connected; an inactive row only matters while it holds a valid claim code.
 */
export function connectionState(view: LinkedAccountView | undefined, now: Date = new Date()): ConnectionState {
  if (!view || !view.active) {
    const claim =
      view?.claimCode && view.claimExpiresAt
        ? { handle: view.handle, code: view.claimCode, expiresAt: view.claimExpiresAt }
        : null;
    return { kind: "disconnected", claim };
  }
  const attempt = view.lastSyncAttemptAt;
  const synced = view.lastSyncedAt;
  const unfinished = attempt !== null && (synced === null || attempt > synced);
  const recent = attempt !== null && now.getTime() - attempt.getTime() < IMPORT_GRACE_MS;
  return {
    kind: "connected",
    handle: view.handle,
    value: view.fieldValue ?? view.handle,
    verified: view.verified,
    verification: view.verified ? null : (view.verification ?? null),
    lastSyncedAt: synced,
    // Linked but never attempted: the first import is queued (after() or the cron).
    importing: (unfinished && recent) || (attempt === null && synced === null),
    failed: unfinished && !recent,
  };
}
