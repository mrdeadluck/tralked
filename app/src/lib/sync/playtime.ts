import type { Prisma } from "@/generated/prisma/client";
import {
  PLAYTIME_MAX_GAMES,
  PLAYTIME_MIN_PAID_H,
  PLAYTIME_NEW_GAMES_PER_DAY,
  playtimeSourceKey,
  reachedMilestones,
} from "@/lib/engine/playtime";

/** Platforms whose real playtime pays XP (lib/engine/playtime.ts). */
export type PlaytimePlatform = "steam" | "psn" | "xbox" | "retro";

const DAY_MS = 86_400_000;
const MIN_PAID_MIN = PLAYTIME_MIN_PAID_H * 60;

/** Paying milestones the playtime has reached (0 below 5 h). */
const milestoneCount = (minutes: number | null) => (minutes === null ? 0 : reachedMilestones(minutes).length);

export type PlaytimeSettlement = {
  /** Games (by `${platform}:${gameId}`) whose new milestones were written. */
  paid: string[];
  /** Games held back by the per-user caps (offered again on a later sync). */
  capped: string[];
};

/**
 * Pays the hours milestones due on one platform, inside the caller's transaction (which already
 * checked the account is still linked). A row is due when its playtime reached more paying
 * milestones than `playtimePaidMin` had. Rules (lib/engine/playtime.ts):
 * - each milestone pays once (unique ledger key; a voided one, from an unlinked or claimed
 *   account, is never paid again);
 * - nothing below 5 h;
 * - a game "starts" paying when its first milestone is paid: at most PLAYTIME_NEW_GAMES_PER_DAY
 *   games start per UTC day, and at most PLAYTIME_MAX_GAMES games ever pay (games are counted
 *   across platforms, by gameId; games already paying keep paying). A capped game keeps its old
 *   `playtimePaidMin`, so a later sync offers it again (next day), or never after the lifetime cap.
 * Entries are dated at the payment (`now`), which is what the daily cap counts. Concurrent syncs of
 * the same user are serialized by an advisory lock, so the caps hold.
 */
export async function settlePlaytime(
  tx: Prisma.TransactionClient,
  userId: string,
  platform: PlaytimePlatform,
  now: Date,
): Promise<PlaytimeSettlement> {
  const rows = await tx.userGame.findMany({
    where: { userId, platform, playtimeMin: { gte: MIN_PAID_MIN } },
    select: { gameId: true, playtimeMin: true, playtimePaidMin: true },
  });
  const due = rows.filter((r) => milestoneCount(r.playtimeMin) > milestoneCount(r.playtimePaidMin));
  const result: PlaytimeSettlement = { paid: [], capped: [] };
  if (due.length === 0) return result;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`playtime:${userId}`}))`;
  const offers = due.map((r) => ({
    ...r,
    entries: reachedMilestones(r.playtimeMin).map((m) => ({
      sourceKey: playtimeSourceKey(platform, r.gameId, m.hours),
      xp: m.xp,
    })),
  }));
  // Keys already in the ledger (paid, or voided by an unlink) are never written again.
  const existing = new Set(
    (
      await tx.xpLedgerEntry.findMany({
        where: { userId, source: "playtime", sourceKey: { in: offers.flatMap((o) => o.entries.map((e) => e.sourceKey)) } },
        select: { sourceKey: true },
      })
    ).map((e) => e.sourceKey),
  );
  const started = await tx.$queryRaw<{ gameId: string; first: Date }[]>`
    SELECT split_part("sourceKey", ':', 2) AS "gameId", min("createdAt") AS "first"
    FROM "XpLedgerEntry"
    WHERE "userId" = ${userId} AND source = 'playtime' AND "voidedAt" IS NULL
    GROUP BY 1`;
  const paying = new Set(started.map((s) => s.gameId));
  const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  let startedToday = started.filter((s) => s.first >= dayStart).length;

  const skillRows = await tx.gameSkill.findMany({
    where: { gameId: { in: offers.map((o) => o.gameId) } },
    select: { gameId: true, skill: true },
  });
  const skillsOf = new Map<string, string[]>();
  for (const s of skillRows) skillsOf.set(s.gameId, [...(skillsOf.get(s.gameId) ?? []), s.skill]);

  // Most played first, so the caps keep the games that matter most.
  offers.sort((a, b) => b.playtimeMin - a.playtimeMin);
  const ledger: Prisma.XpLedgerEntryCreateManyInput[] = [];
  const settled: typeof offers = [];
  for (const offer of offers) {
    const fresh = offer.entries.filter((e) => !existing.has(e.sourceKey));
    if (fresh.length > 0 && !paying.has(offer.gameId)) {
      if (paying.size >= PLAYTIME_MAX_GAMES || startedToday >= PLAYTIME_NEW_GAMES_PER_DAY) {
        result.capped.push(`${platform}:${offer.gameId}`);
        continue;
      }
      paying.add(offer.gameId);
      startedToday++;
    }
    for (const e of fresh) {
      ledger.push({
        userId,
        source: "playtime",
        sourceKey: e.sourceKey,
        // NULL for Steam (the Steam ledger convention; the sourceKey says `steam:`).
        platform: platform === "steam" ? null : platform,
        xp: e.xp,
        skills: skillsOf.get(offer.gameId) ?? [],
        createdAt: now,
      });
    }
    if (fresh.length > 0) result.paid.push(`${platform}:${offer.gameId}`);
    settled.push(offer);
  }
  if (ledger.length > 0) await tx.xpLedgerEntry.createMany({ data: ledger, skipDuplicates: true });
  for (const offer of settled) {
    await tx.userGame.update({
      where: { userId_gameId_platform: { userId, gameId: offer.gameId, platform } },
      data: { playtimePaidMin: offer.playtimeMin },
    });
  }
  return result;
}
