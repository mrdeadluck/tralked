import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable.
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
const SLUG_PREFIX = "test-resolve-";

describe.skipIf(!reachable)("resolvePlatformGame", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
    await prisma.gamePlatformLink.deleteMany({ where: { externalId: { startsWith: "TESTRESOLVE_" } } });
  }

  async function game(name: string, stub: boolean) {
    const { prisma } = await import("@/lib/db");
    return prisma.game.create({
      data: { slug: `${SLUG_PREFIX}${Math.random().toString(36).slice(2, 10)}`, name, stub, achievementCount: 0 },
    });
  }

  const title = (externalId: string, name: string) => ({ externalId: `TESTRESOLVE_${externalId}`, name, platformLabel: "PS5" });

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("finds a stub whatever the apostrophes, accents and trademark signs", async () => {
    const { loadNameIndex, resolvePlatformGame } = await import("./platform-games");
    const wolverine = await game("Marvel's Wolverine Teste Resolve", true);
    const yotei = await game("Ghost of Yōtei Teste Resolve", true);
    const names = await loadNameIndex();
    expect(await resolvePlatformGame("psn", title("1", "Marvel’s Wolverine Teste Resolve™"), names, { igdb: false })).toBe(
      wolverine.id,
    );
    expect(await resolvePlatformGame("psn", title("2", "Ghost of Yotei Teste Resolve"), names, { igdb: false })).toBe(yotei.id);
  });

  it("maps a store edition to its game, listed or stub", async () => {
    const { loadNameIndex, resolvePlatformGame } = await import("./platform-games");
    const listed = await game("Jogo Listado Resolve", false);
    const stub = await game("Jogo Stub Resolve", true);
    const names = await loadNameIndex();
    expect(
      await resolvePlatformGame("psn", title("3", "Jogo Listado Resolve Digital Deluxe Edition"), names, { igdb: false }),
    ).toBe(listed.id);
    expect(
      await resolvePlatformGame("xbox", title("4", "Jogo Stub Resolve - Game of the Year Edition"), names, { igdb: false }),
    ).toBe(stub.id);
  });

  it("leaves two stubs of the same folded name alone (ambiguous)", async () => {
    const { findStubByName } = await import("./platform-games");
    await game("Jogo Duplo Resolve!", true);
    await game("Jogo Duplo: Resolve", true);
    expect(await findStubByName("Jogo Duplo Resolve")).toBeNull();
  });
});
