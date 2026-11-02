import { prisma } from "@/lib/db";
import { connectionFieldValue } from "./connect";
import type { LinkPlatform } from "./profiles";
import { isVerifyFailure, type VerifyFailure } from "./verify";

/** "Verificar agora" in progress on an active, unverified connection (lib/accounts/verify.ts). */
export type PendingVerification = {
  code: string;
  expiresAt: Date;
  /** Why the last check failed; null before the first check or after a new code. */
  failure: VerifyFailure | null;
  checkedAt: Date | null;
};

export type LinkedAccountView = {
  platform: string;
  /** Active connection (typed in or claimed): it syncs and its field shows `fieldValue`. */
  active: boolean;
  handle: string;
  /** What the form field shows for an active connection (Steam: the SteamID64). */
  fieldValue: string | null;
  /** Ownership proven with a code (a claim, or "Verificar agora"). */
  verified: boolean;
  /** Active and unverified, with a "Verificar agora" code still valid. */
  verification: PendingVerification | null;
  /** Code of a claim waiting for confirmation (inactive row, code still valid). */
  claimCode: string | null;
  claimExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  /** Last import attempt of an active connection (later than lastSyncedAt: running or failed). */
  lastSyncAttemptAt: Date | null;
};

/** The user's active connections and pending claims, for the account-connections page. */
export async function getLinkedAccounts(userId: string, now: Date = new Date()): Promise<LinkedAccountView[]> {
  const rows = await prisma.linkedAccount.findMany({
    where: { userId },
    orderBy: { platform: "asc" },
  });
  return rows.flatMap((r) => {
    const active = r.linkedAt !== null;
    const claiming = Boolean(!active && r.verifyCode && r.verifyExpiresAt && r.verifyExpiresAt > now);
    // Unlinked rows, cancelled and expired claims only exist for rate limiting: not shown.
    if (!active && !claiming) return [];
    return [{
      platform: r.platform,
      active,
      handle: r.handle,
      fieldValue: active ? connectionFieldValue(r.platform as LinkPlatform, r) : null,
      verified: r.verifiedAt !== null,
      verification:
        active && !r.verifiedAt && r.verifyCode && r.verifyExpiresAt && r.verifyExpiresAt > now
          ? {
              code: r.verifyCode,
              expiresAt: r.verifyExpiresAt,
              failure: isVerifyFailure(r.verifyFailure) ? r.verifyFailure : null,
              checkedAt: r.verifyCheckedAt,
            }
          : null,
      claimCode: claiming ? r.verifyCode : null,
      claimExpiresAt: claiming ? r.verifyExpiresAt : null,
      lastSyncedAt: active ? r.lastSyncedAt : null,
      // While a claim is pending, lastSyncAttemptAt holds the confirmation cooldown, not an import.
      lastSyncAttemptAt: active ? r.lastSyncAttemptAt : null,
    }];
  });
}
