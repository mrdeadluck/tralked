import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { IgdbCatalogGame } from "@/lib/integrations/igdb/catalog-types";

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
const IGDB = 97_100_000;
const NAME_PREFIX = "Igdbcons ";

const igdbGame = (id: number, name: string, platforms: number[]): IgdbCatalogGame => ({
  igdbId: IGDB + id,
  name,
  platforms,
  steamAppIds: [],
  popularity: 0,
});

describe.skipIf(!reachable)("resolveIgdbGames consoles", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("igdb import writes consoles", async () => {
    const { prisma } = await import("@/lib/db");
    const { resolveIgdbGames } = await import("./igdb-games");
    // IGDB platforms: 48 PS4, 167 PS5, 6 Windows, 12 Xbox 360, 99999 unknown to the table.
    const created = await resolveIgdbGames([igdbGame(1, `${NAME_PREFIX}Novo`, [167, 48, 6, 99999])]);
    const stub = await prisma.game.findUniqueOrThrow({ where: { id: created.ids.get(IGDB + 1)! } });
    expect(stub.platforms).toEqual(["PC", "PLAYSTATION"]);
    expect(stub.consoles).toEqual(["pc", "ps4", "ps5"]);

    // A matched game (here the PSN one, by IGDB id) gets the consoles added to what it had.
    const known = await prisma.game.create({
      data: { slug: "igdbcons-known", name: `${NAME_PREFIX}Conhecido`, igdbId: IGDB + 2, platforms: ["PLAYSTATION"], consoles: ["ps5"], achievementCount: 0 },
    });
    await resolveIgdbGames([igdbGame(2, `${NAME_PREFIX}Conhecido`, [48, 12])]);
    const after = await prisma.game.findUniqueOrThrow({ where: { id: known.id } });
    expect(after.consoles).toEqual(["ps4", "ps5", "xbox360"]);
    expect(after.platforms).toEqual(["PLAYSTATION", "XBOX"]);
  });
});
