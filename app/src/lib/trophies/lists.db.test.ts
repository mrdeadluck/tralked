import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ensureTrophyList } from "./lists";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-tl` prefix and are removed.
const PREFIX = "test-tl";
let gameA: string;
let gameB: string;

async function cleanup() {
  await prisma.trophyList.deleteMany({ where: { externalId: { startsWith: `${PREFIX}-` } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  gameA = (await prisma.game.create({ data: { slug: `${PREFIX}-a`, name: "A", achievementCount: 0, platforms: ["PS4"] } })).id;
  gameB = (await prisma.game.create({ data: { slug: `${PREFIX}-b`, name: "B", achievementCount: 0, platforms: ["PS4"] } })).id;
});
afterAll(cleanup);

const base = (over: Record<string, unknown> = {}) => ({
  gameId: gameA,
  platform: "psn",
  externalId: `${PREFIX}-NPWR1`,
  console: "PS4" as string | null,
  name: "Game",
  trophyCount: 10,
  ...over,
});

describe("ensureTrophyList", () => {
  it("creates then updates name and count", async () => {
    const a = await ensureTrophyList(prisma, base({ serviceName: "trophy", conceptId: 5 }));
    expect(a.console).toBe("PS4");
    const b = await ensureTrophyList(prisma, base({ name: "ゲーム", trophyCount: 12 }));
    expect(b.id).toBe(a.id);
    const row = await prisma.trophyList.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.name).toBe("ゲーム");
    expect(row.trophyCount).toBe(12);
    expect(row.region).toBe("jp");
    expect(row.serviceName).toBe("trophy");
    expect(row.conceptId).toBe(5);
    await ensureTrophyList(prisma, base({ name: "Game" }));
    expect((await prisma.trophyList.findUniqueOrThrow({ where: { id: a.id } })).region).toBeNull();
  });

  it("fills console, conceptId and serviceName only when null", async () => {
    const externalId = `${PREFIX}-NPWR2`;
    const a = await ensureTrophyList(prisma, base({ externalId, console: null }));
    expect(a.console).toBeNull();
    await ensureTrophyList(prisma, base({ externalId, console: "PS5", serviceName: "trophy2", conceptId: 7 }));
    await ensureTrophyList(prisma, base({ externalId, console: "PS4", serviceName: "trophy", conceptId: 8 }));
    const row = await prisma.trophyList.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.console, row.serviceName, row.conceptId]).toEqual(["PS5", "trophy2", 7]);
  });

  it("never rewrites a stored console", async () => {
    const externalId = `${PREFIX}-NPWR3`;
    await ensureTrophyList(prisma, base({ externalId, console: "PS4" }));
    const again = await ensureTrophyList(prisma, base({ externalId, console: "PS4+PS5" }));
    expect(again.console).toBe("PS4");
  });

  it("never moves a list to another game", async () => {
    const externalId = `${PREFIX}-NPWR4`;
    await ensureTrophyList(prisma, base({ externalId }));
    const again = await ensureTrophyList(prisma, base({ externalId, gameId: gameB }));
    expect(again.gameId).toBe(gameA);
  });

  it("works inside a transaction and survives a concurrent create", async () => {
    const externalId = `${PREFIX}-NPWR5`;
    const [x, y] = await Promise.all([
      ensureTrophyList(prisma, base({ externalId })),
      ensureTrophyList(prisma, base({ externalId })),
    ]);
    expect(x.id).toBe(y.id);
    const viaTx = await prisma.$transaction((tx) => ensureTrophyList(tx, base({ externalId })));
    expect(viaTx.id).toBe(x.id);
  });
});
