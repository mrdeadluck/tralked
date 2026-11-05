import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getGameProfileForUser } from "./game-profile";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-a7g` prefix and are removed.
const PREFIX = "test-a7g";
const T0 = new Date("2026-10-20T12:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
beforeAll(cleanup);
afterAll(cleanup);

describe("XP this game paid", () => {
  it("reads canonical achievement keys, version platinum keys and ignores voided entries", async () => {
    const user = await prisma.user.create({ data: { handle: `${PREFIX}-1`, displayName: "Teste" } });
    const game = await prisma.game.create({
      data: { slug: `${PREFIX}-g`, name: "Jogo", achievementCount: 0, platforms: ["PS5"] },
    });
    const other = await prisma.game.create({
      data: { slug: `${PREFIX}-o`, name: "Outro", achievementCount: 0, platforms: ["PS5"] },
    });
    const canonical = await prisma.trophyList.create({
      data: { gameId: game.id, platform: "psn", externalId: `${PREFIX}-A`, console: "PS5", name: "A", createdAt: at(0) },
    });
    const regional = await prisma.trophyList.create({
      data: { gameId: game.id, platform: "psn", externalId: `${PREFIX}-B`, console: "PS5", name: "B", createdAt: at(1) },
    });
    const canonAch = await prisma.achievement.create({
      data: { gameId: game.id, platform: "psn", apiName: "1", name: "T", trophyTier: "bronze", listId: canonical.id },
    });
    const regionalAch = await prisma.achievement.create({
      data: { gameId: game.id, platform: "psn", apiName: "1", name: "T", trophyTier: "bronze", listId: regional.id },
    });
    // The player only has the regional copy; the ledger is keyed by the canonical one.
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: regionalAch.id, unlockedAt: at(5) } });
    await prisma.userGame.create({ data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 60, unlockedCount: 1 } });
    const entry = (source: string, sourceKey: string, xp: number, voidedAt: Date | null = null) => ({
      userId: user.id, source, sourceKey, xp, skills: [], platform: "psn", voidedAt,
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        entry("achievement", canonAch.id, 20),
        entry("platinum", `psn:PS5:${game.id}`, 300),
        entry("platinum", `psn:PS4:${game.id}`, 5, at(9)), // voided: never counts
        entry("platinum", `psn:PS5:${other.id}`, 1000), // another game
      ],
    });

    const profile = await getGameProfileForUser(game.slug, user.id);
    expect(profile?.attributes?.xp).toBe(320);
  });
});
