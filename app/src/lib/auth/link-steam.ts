import { Prisma, type User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSteam } from "@/lib/integrations";

export type SteamLinkResult = { ok: true; user: User } | { ok: false; reason: "in_use" | "has_other" };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Steam login by a user who is already logged in without Steam (e.g. a Google-only account):
 * attaches the Steam account (OpenID already proved ownership) to that user instead of creating
 * a second account. Refused when the SteamID belongs to another user (their User.steamId or a
 * verified LinkedAccount) or when this user already has a different Steam account. An
 * unverified Steam LinkedAccount of someone else (never proven) is dropped, since OpenID is proof.
 */
export async function linkSteamToUser(userId: string, steamId: string, now: Date = new Date()): Promise<SteamLinkResult> {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (current.steamId && current.steamId !== steamId) return { ok: false, reason: "has_other" };

  const [owner, verifiedElsewhere] = await Promise.all([
    prisma.user.findUnique({ where: { steamId }, select: { id: true } }),
    prisma.linkedAccount.findFirst({
      where: { platform: "steam", externalId: steamId, verifiedAt: { not: null }, userId: { not: userId } },
      select: { id: true },
    }),
  ]);
  if ((owner && owner.id !== userId) || verifiedElsewhere) return { ok: false, reason: "in_use" };

  const summary = await getSteam().getPlayerSummary(steamId);
  try {
    const user = await prisma.$transaction(async (tx) => {
      await tx.linkedAccount.deleteMany({
        where: { platform: "steam", externalId: steamId, verifiedAt: null, userId: { not: userId } },
      });
      // The `steamId: null` guard makes a concurrent link of another Steam account fail instead of replacing it.
      const { count } = await tx.user.updateMany({
        where: { id: userId, OR: [{ steamId: null }, { steamId }] },
        data: { steamId, avatarUrl: current.avatarUrl ?? summary.avatarUrl },
      });
      if (count === 0) return null;
      await tx.linkedAccount.upsert({
        where: { userId_platform: { userId, platform: "steam" } },
        create: { userId, platform: "steam", externalId: steamId, handle: summary.personaName, verifiedAt: now },
        update: { externalId: steamId, handle: summary.personaName, verifiedAt: now, verifyCode: null, verifyExpiresAt: null },
      });
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
    return user ? { ok: true, user } : { ok: false, reason: "has_other" };
  } catch (error) {
    // Another user took this SteamID at the same moment.
    if (isUniqueViolation(error)) return { ok: false, reason: "in_use" };
    throw error;
  }
}
