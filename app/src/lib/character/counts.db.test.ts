import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { nativePlatinums, platinumCount, regionalExtras } from "./counts";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-a7c` prefix and are removed.
const PREFIX = "test-a7c";
const T0 = new Date("2026-10-20T12:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
let counter = 0;

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
beforeAll(cleanup);
afterAll(cleanup);

describe("native platinums and regional extras", () => {
  it("PS4 + PS5 platinum = 2 platinums, a second PS5 region = 1 regional extra", async () => {
    counter++;
    const user = await prisma.user.create({ data: { handle: `${PREFIX}-${counter}`, displayName: "Teste" } });
    const game = await prisma.game.create({
      data: { slug: `${PREFIX}-${counter}`, name: "Jogo", achievementCount: 0, platforms: ["PS5"] },
    });
    const consoles = ["PS4", "PS5", "PS5"];
    for (const [i, c] of consoles.entries()) {
      const list = await prisma.trophyList.create({
        data: { gameId: game.id, platform: "psn", externalId: `${PREFIX}-L${i}`, console: c, name: "Lista", createdAt: at(i) },
      });
      const ach = await prisma.achievement.create({
        data: { gameId: game.id, platform: "psn", apiName: "0", name: "Platina", trophyTier: "platinum", listId: list.id },
      });
      await prisma.userAchievement.create({ data: { userId: user.id, achievementId: ach.id, unlockedAt: at(10 + i) } });
    }
    const native = await nativePlatinums(user.id);
    expect(native).toHaveLength(2);
    expect(platinumCount(native, [])).toBe(2);
    expect(await regionalExtras(user.id)).toBe(1);
  });
});
