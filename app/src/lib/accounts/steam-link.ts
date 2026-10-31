import { prisma } from "@/lib/db";
import {
  checkPendingCode,
  HolderChanged,
  isKnownError,
  Raced,
  releaseForClaim,
  settleRelease,
  takeOverAccount,
  type ConfirmClaimFailure,
  type TooSoon,
} from "./link";

/**
 * Confirming a claim of a Steam account (the code is in the profile "Resumo", see ./link.ts). On
 * top of the PSN/Xbox/RA rules, Steam fills User.steamId (the Steam sync reads it) and handles the
 * accounts created by the old Steam login (OpenID, removed). Typing a Steam that is already on
 * another profile is refused (./connect.ts), so this claim is the only way to any of these:
 *
 * - The Steam belongs to nobody: linked to this account, verified.
 * - It belongs to an account with credentials (password or Google), or is an active link of
 *   another profile: it moves to this account (verified); the other one loses it (XP from it
 *   voided) and is notified.
 * - It belongs to an old account without credentials (no password, no Google): that account is
 *   recovered. The e-mail/password (and Google) of this new account move to it, the new account
 *   (still empty) is deleted, and the caller moves the session to the old one, which keeps its
 *   handle, XP, achievements and role. If this account already has activity, nothing is merged
 *   ("has_activity"): deleting it would lose that activity.
 */

export type SteamClaim = { userId: string; handle: string };

export type ConfirmSteamResult =
  | { ok: true; handle: string; recovered: SteamClaim | null }
  | { ok: false; reason: Exclude<ConfirmClaimFailure, "too_soon"> | "has_activity" | "different" }
  | TooSoon;

/** Anything the user did on Tralked that deleting the account would lose. */
async function hasActivity(userId: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      membership: { select: { userId: true } },
      _count: {
        select: {
          linkedAccounts: { where: { linkedAt: { not: null } } },
          ledger: true,
          comments: true,
          forumThreads: true,
          forumPosts: true,
          photos: true,
          guidesWritten: true,
          tips: true,
          revisions: true,
          // Likes and votes feed denormalized counters that a plain delete would not lower.
          photoLikes: true,
          votes: true,
          reportsFiled: true,
          stepProgress: true,
          ownedFamilies: true,
        },
      },
    },
  });
  return user.membership !== null || Object.values(user._count).some((count) => count > 0);
}

export async function confirmSteamClaim(userId: string, now: Date = new Date()): Promise<ConfirmSteamResult> {
  const check = await checkPendingCode(userId, "steam", now);
  if (!check.ok) return check;
  const { pending, profile } = check;
  if (profile.isPrivate) return { ok: false, reason: "private" };
  const steamId = profile.externalId;

  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (me.steamId && me.steamId !== steamId) return { ok: false, reason: "different" };

  // The account whose User.steamId it is (an old Steam-login account) comes first; otherwise the
  // profile that has it as an active link.
  const ownerFields = { id: true, handle: true, passwordHash: true, googleSub: true } as const;
  const owner =
    (await prisma.user.findFirst({ where: { id: { not: userId }, steamId }, select: ownerFields })) ??
    (await prisma.user.findFirst({
      where: { id: { not: userId }, linkedAccounts: { some: { platform: "steam", externalId: steamId, linkedAt: { not: null } } } },
      select: ownerFields,
    }));

  if (!owner || owner.passwordHash || owner.googleSub) {
    const moved = await takeOverAccount(userId, pending, profile, now);
    return moved.ok ? { ok: true, handle: moved.handle, recovered: null } : moved;
  }

  // An account of the old Steam login, without credentials: recover it instead of emptying it.
  if (await hasActivity(userId)) return { ok: false, reason: "has_activity" };
  // A third profile holding this Steam as an active link loses it (the old account owns it).
  let third: { userId: string; released: { days: string[] } | null } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const other = await tx.linkedAccount.findFirst({
        where: { platform: "steam", externalId: steamId, linkedAt: { not: null }, userId: { notIn: [owner.id, userId] } },
        select: { userId: true },
      });
      if (other) third = { userId: other.userId, released: await releaseForClaim(tx, other.userId, "steam", profile, now) };
      // The new account goes first, freeing its unique e-mail / Google sub for the old one
      // (its pending Steam row and reset links cascade with it).
      await tx.user.delete({ where: { id: userId } });
      // Only an account that still has no credentials can be taken over this way.
      const { count } = await tx.user.updateMany({
        where: { id: owner.id, passwordHash: null, googleSub: null },
        data: {
          email: me.email ?? undefined,
          // The e-mail's confirmation goes with it.
          ...(me.email ? { emailVerifiedAt: me.emailVerifiedAt } : {}),
          passwordHash: me.passwordHash,
          googleSub: me.googleSub,
          steamId,
        },
      });
      if (count === 0) throw new Raced();
      const existing = await tx.linkedAccount.findUnique({
        where: { userId_platform: { userId: owner.id, platform: "steam" } },
      });
      const verified = {
        externalId: steamId,
        handle: profile.handle,
        linkedAt: existing?.linkedAt ?? now,
        verifiedAt: existing?.verifiedAt ?? now,
        verifyCode: null,
        verifyExpiresAt: null,
      };
      await tx.linkedAccount.upsert({
        where: { userId_platform: { userId: owner.id, platform: "steam" } },
        create: { userId: owner.id, platform: "steam", ...verified },
        update: verified,
      });
    });
  } catch (error) {
    // The old account got credentials (or this Steam another owner) at the same moment.
    if (error instanceof Raced || error instanceof HolderChanged || isKnownError(error, "P2002")) {
      return { ok: false, reason: "taken" };
    }
    throw error;
  }
  const settled = third as { userId: string; released: { days: string[] } | null } | null;
  if (settled?.released) await settleRelease(settled.userId, settled.released, now);
  return { ok: true, handle: profile.handle, recovered: { userId: owner.id, handle: owner.handle } };
}
