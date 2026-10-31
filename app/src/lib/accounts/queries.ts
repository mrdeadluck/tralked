import { prisma } from "@/lib/db";

export type LinkedAccountView = {
  platform: string;
  handle: string;
  verified: boolean;
  /** Code to paste in the profile while the link is pending and not expired. */
  pendingCode: string | null;
  codeExpiresAt: Date | null;
  lastSyncedAt: Date | null;
};

/** The user's connected and pending accounts, for the account-connections page. */
export async function getLinkedAccounts(userId: string, now: Date = new Date()): Promise<LinkedAccountView[]> {
  const rows = await prisma.linkedAccount.findMany({
    where: { userId },
    orderBy: { platform: "asc" },
  });
  return rows.map((r) => {
    const pending = !r.verifiedAt && r.verifyCode && r.verifyExpiresAt && r.verifyExpiresAt > now;
    return {
      platform: r.platform,
      handle: r.handle,
      verified: r.verifiedAt !== null,
      pendingCode: pending ? r.verifyCode : null,
      codeExpiresAt: pending ? r.verifyExpiresAt : null,
      lastSyncedAt: r.lastSyncedAt,
    };
  });
}
