import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("consoles backfill writes", () => {
  const tag = `consql${Date.now().toString(36)}`;
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  it("mergeConsoles adds to what the row holds now instead of replacing it", async () => {
    const { prisma } = await import("@/lib/db");
    const { mergeConsoles } = await import("./consoles-sql");
    const game = await prisma.game.create({ data: { slug: `${tag}-m`, name: `${tag} m`, platforms: ["PLAYSTATION"], achievementCount: 0, consoles: ["ps4", "ps5"] } });
    // The script read ["ps4"]; a sync added ps5 meanwhile.
    await mergeConsoles(prisma, [{ id: game.id, consoles: ["ps4", "psvita"] }]);
    const after = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(after.consoles).toEqual(["ps4", "ps5", "psvita"]);
  });

  it("writeLabelChanges skips a row whose platforms changed since it was read, and merges consoles", async () => {
    const { prisma } = await import("@/lib/db");
    const { writeLabelChanges } = await import("./consoles-sql");
    const stale = await prisma.game.create({ data: { slug: `${tag}-s`, name: `${tag} s`, platforms: ["PLAYSTATION", "PC"], achievementCount: 0, consoles: ["ps5"] } });
    const fresh = await prisma.game.create({ data: { slug: `${tag}-f`, name: `${tag} f`, platforms: ["PS4"], achievementCount: 0, consoles: ["ps5"] } });
    await writeLabelChanges(prisma, [
      { id: stale.id, oldPlatforms: ["PS4"], platforms: ["PLAYSTATION"], consoles: ["ps4"] },
      { id: fresh.id, oldPlatforms: ["PS4"], platforms: ["PLAYSTATION"], consoles: ["ps4"] },
    ]);
    const s = await prisma.game.findUniqueOrThrow({ where: { id: stale.id } });
    const f = await prisma.game.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(s).toMatchObject({ platforms: ["PLAYSTATION", "PC"], consoles: ["ps5"] });
    expect(f).toMatchObject({ platforms: ["PLAYSTATION"], consoles: ["ps4", "ps5"] });
  });
});
