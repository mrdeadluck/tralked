import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createAchievements } from "@/lib/trophies/test-lists";
import { loadTimeTo100 } from "./time-to-100";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-t100` prefix and are removed.
const PREFIX = "test-t100";

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
afterAll(cleanup);
beforeEach(cleanup);

describe("loadTimeTo100", () => {
  it("leaves out completions with an undated unlock: their playtime is unreliable", async () => {
    const game = await prisma.game.create({ data: { slug: `${PREFIX}-g`, name: "T", achievementCount: 1, platforms: ["Steam"] } });
    const [ach] = await createAchievements(game.id, [{ platform: "steam", apiName: "A0", name: "A0" }]);
    const done = new Date("2024-01-01T00:00:00Z");
    const mk = async (name: string, playtimeMin: number, unlockedAt: Date | null) => {
      const u = await prisma.user.create({ data: { handle: `${PREFIX}-${name}`, displayName: name } });
      await prisma.userGame.create({ data: { userId: u.id, gameId: game.id, platform: "steam", playtimeMin, unlockedCount: 1, completedAt: done } });
      await prisma.userAchievement.create({ data: { userId: u.id, achievementId: ach.id, unlockedAt } });
    };
    await mk("dated1", 6000, done);
    await mk("dated2", 7000, done);
    await mk("undated", 30, null);

    expect(await loadTimeTo100(game.id, null)).toEqual({ minutes: 6500, source: "tralked", players: 2 });
  });
});
