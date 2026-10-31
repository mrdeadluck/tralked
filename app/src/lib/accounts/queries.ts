import { prisma } from "@/lib/db";

export type LinkedAccountView = {
  platform: string;
  handle: string;
  verified: boolean;
  /** Code to paste in the profile while the link is pending and not expired. */
  pendingCode: string | null;
  codeExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  /** Last import attempt of a verified account (later than lastSyncedAt: running or failed). */
  lastSyncAttemptAt: Date | null;
};

/** The user's connected and pending accounts, for the account-connections page. */
export async function getLinkedAccounts(userId: string, now: Date = new Date()): Promise<LinkedAccountView[]> {
  const rows = await prisma.linkedAccount.findMany({
    where: { userId },
    orderBy: { platform: "asc" },
  });
  return rows.flatMap((r) => {
    const pending = Boolean(!r.verifiedAt && r.verifyCode && r.verifyExpiresAt && r.verifyExpiresAt > now);
    // An attempt whose code expired is shown as such (handle prefilled for a new code); unlinked
    // and cancelled rows (no code) only exist for rate limiting and are not shown.
    if (!r.verifiedAt && !r.verifyCode) return [];
    return [{
      platform: r.platform,
      handle: r.handle,
      verified: r.verifiedAt !== null,
      pendingCode: pending ? r.verifyCode : null,
      codeExpiresAt: pending ? r.verifyExpiresAt : null,
      lastSyncedAt: r.lastSyncedAt,
      // While pending, lastSyncAttemptAt holds the confirmation cooldown, not an import.
      lastSyncAttemptAt: r.verifiedAt ? r.lastSyncAttemptAt : null,
    }];
  });
}
