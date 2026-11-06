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
    await prisma.game.deleteMany({ where: { OR: [{ slug: { startsWith: SLUG_PREFIX } }, { name: { endsWith: " Console Resolve" } }] } });
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

  it("a PSN-created game is PLAYSTATION with console ps5", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadNameIndex, resolvePlatformGame } = await import("./platform-games");
    const names = await loadNameIndex();
    const id = await resolvePlatformGame("psn", title("5", "Jogo Novo Console Resolve"), names, { igdb: false });
    const created = await prisma.game.findUniqueOrThrow({ where: { id } });
    expect(created.platforms).toEqual(["PLAYSTATION"]);
    expect(created.consoles).toEqual(["ps5"]);
    // Xbox titles name no single console: the family only.
    const xbox = await resolvePlatformGame("xbox", { externalId: "TESTRESOLVE_6", name: "Jogo Xbox Console Resolve", platformLabel: "Xbox" }, names, { igdb: false });
    const xboxGame = await prisma.game.findUniqueOrThrow({ where: { id: xbox } });
    expect(xboxGame.platforms).toEqual(["XBOX"]);
    expect(xboxGame.consoles).toEqual([]);
  });

  it("a game created from a multi-console PSN label records every console", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadNameIndex, resolvePlatformGame } = await import("./platform-games");
    const names = await loadNameIndex();
    const both = await resolvePlatformGame("psn", { externalId: "TESTRESOLVE_7", name: "Jogo Dois Console Resolve", platformLabel: "PS4,PS5" }, names, { igdb: false });
    const created = await prisma.game.findUniqueOrThrow({ where: { id: both } });
    expect(created.platforms).toEqual(["PLAYSTATION"]);
    expect(created.consoles).toEqual(["ps4", "ps5"]);
    const old = await resolvePlatformGame("psn", { externalId: "TESTRESOLVE_8", name: "Jogo Antigo Console Resolve", platformLabel: "PS3,PSVITA" }, names, { igdb: false });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: old } })).consoles).toEqual(["ps3", "psvita"]);
  });
});
