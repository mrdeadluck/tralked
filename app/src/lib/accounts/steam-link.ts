import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { checkPendingCode, type ConfirmLinkFailure, type TooSoon } from "./link";

/**
 * Confirming a Steam connection (the code is in the profile "Resumo", see ./link.ts). On top of
 * the PSN/Xbox/RA rules, Steam fills User.steamId (the Steam sync reads it) and handles the
 * accounts created by the old Steam login (OpenID, removed):
 *
 * - The Steam belongs to nobody: linked to this account.
 * - It belongs to an account with credentials (password or Google): refused, "taken".
 * - It belongs to an old account without credentials (no password, no Google): that account is
 *   recovered. The e-mail/password (and Google) of this new account move to it, the new account
 *   (still empty) is deleted, and the caller moves the session to the old one, which keeps its
 *   handle, XP, achievements and role. If this account already has activity, nothing is merged
 *   ("has_activity"): deleting it would lose that activity.
 */

export type SteamClaim = { userId: string; handle: string };

export type ConfirmSteamResult =
  | { ok: true; handle: string; claimed: SteamClaim | null }
  | { ok: false; reason: Exclude<ConfirmLinkFailure, "too_soon"> | "has_activity" | "different" }
  | TooSoon;

const isKnownError = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

/** Thrown inside a transaction to roll it back when a guarded update matched nothing. */
class Raced extends Error {}

/** Anything the user did on Tralked that deleting the account would lose. */
async function hasActivity(userId: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      membership: { select: { userId: true } },
      _count: {
        select: {
          linkedAccounts: { where: { verifiedAt: { not: null } } },
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

export async function confirmSteamLink(userId: string, now: Date = new Date()): Promise<ConfirmSteamResult> {
  const check = await checkPendingCode(userId, "steam", now);
  if (!check.ok) return check;
  const { pending, profile } = check;
  const steamId = profile.externalId;

  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (me.steamId && me.steamId !== steamId) return { ok: false, reason: "different" };

  const owner = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      OR: [{ steamId }, { linkedAccounts: { some: { platform: "steam", externalId: steamId, verifiedAt: { not: null } } } }],
    },
    select: { id: true, handle: true, passwordHash: true, googleSub: true },
  });

  // Never-proven Steam rows of other users (e.g. imported unverified) do not block the owner.
  const dropUnproven = (tx: Prisma.TransactionClient, keepUserId: string) =>
    tx.linkedAccount.deleteMany({
      where: { platform: "steam", externalId: steamId, verifiedAt: null, userId: { not: keepUserId } },
    });

  if (!owner) {
    try {
      await prisma.$transaction(async (tx) => {
        await dropUnproven(tx, userId);
        // The guard makes a concurrent link of another Steam account fail instead of replacing it.
        const { count } = await tx.user.updateMany({
          where: { id: userId, OR: [{ steamId: null }, { steamId }] },
          data: { steamId },
        });
        if (count === 0) throw new Raced();
        await tx.linkedAccount.update({
          where: { id: pending.id, verifiedAt: null, verifyCode: pending.verifyCode },
          data: { externalId: steamId, handle: profile.handle, verifiedAt: now, verifyCode: null, verifyExpiresAt: null },
        });
      });
    } catch (error) {
      if (error instanceof Raced) return { ok: false, reason: "different" };
      // Another user verified this Steam account a moment earlier.
      if (isKnownError(error, "P2002")) return { ok: false, reason: "taken" };
      // The pending link changed under us (restarted or confirmed concurrently).
      if (isKnownError(error, "P2025")) return { ok: false, reason: "expired" };
      throw error;
    }
    return { ok: true, handle: profile.handle, claimed: null };
  }

  if (owner.passwordHash || owner.googleSub) return { ok: false, reason: "taken" };
  if (await hasActivity(userId)) return { ok: false, reason: "has_activity" };

  try {
    await prisma.$transaction(async (tx) => {
      // The new account goes first, freeing its unique e-mail / Google sub for the old one
      // (its pending Steam row and reset links cascade with it).
      await tx.user.delete({ where: { id: userId } });
      // Only an account that still has no credentials can be taken over this way.
      const { count } = await tx.user.updateMany({
        where: { id: owner.id, passwordHash: null, googleSub: null },
        data: {
          email: me.email ?? undefined,
          passwordHash: me.passwordHash,
          googleSub: me.googleSub,
          steamId,
        },
      });
      if (count === 0) throw new Raced();
      await dropUnproven(tx, owner.id);
      const existing = await tx.linkedAccount.findUnique({
        where: { userId_platform: { userId: owner.id, platform: "steam" } },
      });
      const verified = {
        externalId: steamId,
        handle: profile.handle,
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
    if (error instanceof Raced || isKnownError(error, "P2002")) return { ok: false, reason: "taken" };
    throw error;
  }
  return { ok: true, handle: profile.handle, claimed: { userId: owner.id, handle: owner.handle } };
}
