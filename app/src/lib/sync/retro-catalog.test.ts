import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { RetroCatalogApi, RetroCatalogEntry } from "@/lib/integrations/retro/catalog";
import { isCoreSet, pickRetroMatch, retroTitleNames } from "./retro-catalog";

describe("RA titles", () => {
  it("puts a trailing article back in front and splits alternative names", () => {
    expect(retroTitleNames("Legend of Zelda, The: A Link to the Past")).toEqual(["The Legend of Zelda: A Link to the Past"]);
    expect(retroTitleNames("Simpsons, The - Bart vs. the Space Mutants")).toEqual(["The Simpsons - Bart vs. the Space Mutants"]);
    expect(retroTitleNames("Lost Vikings, The")).toEqual(["The Lost Vikings"]);
    expect(retroTitleNames("Pocket Monsters Aka | Pokemon Red Version")).toEqual(["Pocket Monsters Aka", "Pokemon Red Version"]);
    expect(retroTitleNames("Sonic the Hedgehog™  2")).toEqual(["Sonic the Hedgehog 2"]);
    // A comma that is not an inverted article stays.
    expect(retroTitleNames("Hello, A Story Of")).toEqual(["Hello, A Story Of"]);
  });

  it("tells tagged sets and subsets from games", () => {
    expect(isCoreSet("Super Mario World")).toBe(true);
    expect(isCoreSet("~Hack~ Super Mario World: Kaizo")).toBe(false);
    expect(isCoreSet("~Homebrew~ Tetris")).toBe(false);
    expect(isCoreSet("Super Mario 64 [Subset - Bonus]")).toBe(false);
  });
});

describe("pickRetroMatch", () => {
  const c = (id: string, platforms: string[], links: string[] = []) => ({ input: "x", id, platforms, links });

  it("takes a game of the console's family, or of no known family", () => {
    expect(pickRetroMatch([c("snes", ["NINTENDO"]), c("pc", ["PC"], ["steam"])], "SNES/Super Famicom")).toBe("snes");
    expect(pickRetroMatch([c("bare", [])], "Game Boy")).toBe("bare");
    expect(pickRetroMatch([c("ps", ["PLAYSTATION"])], "PlayStation 2")).toBe("ps");
  });

  it("never takes a PC game for a console without a family, nor a game holding another RA set", () => {
    expect(pickRetroMatch([c("pc", ["PC"], ["steam"])], "Mega Drive")).toBeNull();
    expect(pickRetroMatch([c("taken", ["NINTENDO"], ["retro"])], "NES/Famicom")).toBeNull();
  });

  it("is ambiguous with two fits, the same game twice is one", () => {
    expect(pickRetroMatch([c("a", ["NINTENDO"]), c("b", ["NINTENDO"])], "Nintendo 64")).toBe("ambiguous");
    expect(pickRetroMatch([c("a", ["NINTENDO"]), c("a", ["NINTENDO"])], "Nintendo 64")).toBe("a");
  });
});

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
const ID = 98_000_000;
const TAG = "Zzretrotest";

function fakeApi(lists: Record<number, RetroCatalogEntry[]>, failing: number[] = []): RetroCatalogApi {
  return {
    async getConsoles() {
      return Object.keys(lists).map((id) => ({ id: Number(id), name: `Console ${id}` }));
    },
    async getGameList(consoleId) {
      if (failing.includes(consoleId)) throw new Error("RetroAchievements API_GetGameList failed with HTTP 500");
      return lists[consoleId].map((g) => ({ ...g }));
    },
    async getGameAchievements() {
      return [];
    },
  };
}

const entry = (id: number, title: string, consoleId: number, consoleName: string): RetroCatalogEntry => ({
  id: ID + id,
  title,
  consoleId,
  consoleName,
  iconPath: `/Images/${id}.png`,
  achievementCount: 10,
  points: 100,
  modifiedAt: new Date("2026-01-01T00:00:00Z"),
});

describe.skipIf(!reachable)("RetroAchievements catalog import", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.retroCatalogGame.deleteMany({ where: { id: { gte: ID, lt: ID + 1000 } } });
    await prisma.game.deleteMany({ where: { name: { contains: TAG } } });
  }
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("imports the light rows, rewriting only what RA changed", async () => {
    const { prisma } = await import("@/lib/db");
    const { importRetroCatalog } = await import("./retro-catalog");
    const lists = {
      3: [entry(1, `${TAG} Quest, The: Retro`, 3, "SNES/Super Famicom")],
      1: [entry(2, `${TAG} Hedgehog`, 1, ""), entry(3, `~Hack~ ${TAG} Hedgehog`, 1, "Mega Drive")],
    };
    const warnings: string[] = [];
    const log = { info: () => {}, warn: (m: string) => warnings.push(m) };
    await expect(importRetroCatalog(fakeApi(lists, [7]), log)).resolves.toEqual({ consoles: 2, games: 3, written: 3, failedConsoles: 0 });
    const row = await prisma.retroCatalogGame.findUniqueOrThrow({ where: { id: ID + 2 } });
    // An empty console name in the list takes the console's own name.
    expect(row).toMatchObject({ title: `${TAG} Hedgehog`, consoleId: 1, consoleName: "Console 1", iconPath: "/Images/2.png", achievementCount: 10, points: 100 });

    // Same lists: nothing written. One set changed: one row.
    await expect(importRetroCatalog(fakeApi(lists), log)).resolves.toMatchObject({ written: 0 });
    lists[3][0] = { ...lists[3][0], achievementCount: 12, modifiedAt: new Date("2026-06-01T00:00:00Z") };
    await expect(importRetroCatalog(fakeApi({ ...lists, 7: [] }, [7]), log)).resolves.toMatchObject({ written: 1, failedConsoles: 1 });
    expect(warnings).toEqual(["RA console 7 (Console 7): RetroAchievements API_GetGameList failed with HTTP 500"]);
    expect((await prisma.retroCatalogGame.findUniqueOrThrow({ where: { id: ID + 1 } })).setModifiedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("links RA games to catalog games of their family, creates stubs for the rest, leaves hacks alone", async () => {
    const { prisma } = await import("@/lib/db");
    const { linkRetroCatalog } = await import("./retro-catalog");
    // The SNES game the catalog already has (IGDB name style, folded: no colon), and a PC game
    // named like the Mega Drive one.
    const snes = await prisma.game.create({
      data: { slug: "zzretrotest-quest", name: `The ${TAG} Quest - Retro`, platforms: ["NINTENDO"], achievementCount: 0 },
    });
    const pc = await prisma.game.create({
      data: { slug: "zzretrotest-hedgehog", name: `${TAG} Hedgehog`, platforms: ["PC"], achievementCount: 0, steamAppId: 98_000_001 },
    });
    // Two RA games of one name on two consoles without a family: two pages.
    await prisma.retroCatalogGame.createMany({
      data: [
        { id: ID + 4, title: `${TAG} Arcade`, consoleId: 27, consoleName: "Arcade", achievementCount: 5, points: 50 },
        { id: ID + 5, title: `${TAG} Arcade`, consoleId: 25, consoleName: "Atari 2600", achievementCount: 5, points: 50 },
      ],
    });

    const at = new Date("2026-11-02T12:00:00Z");
    const result = await linkRetroCatalog({ now: () => at });
    expect(result).toEqual({ linked: 1, created: 3, ambiguous: 0, skipped: 1 });

    const link = async (id: number) =>
      prisma.gamePlatformLink.findUnique({
        where: { platform_externalId: { platform: "retro", externalId: String(ID + id) } },
        include: { game: { select: { id: true, name: true, slug: true, stub: true, platforms: true } } },
      });
    expect((await link(1))?.gameId).toBe(snes.id);
    const hedgehog = await link(2);
    expect(hedgehog?.gameId).not.toBe(pc.id);
    // The PC game's slug was taken: the stub's gets the RA id.
    expect(hedgehog?.game).toMatchObject({ name: `${TAG} Hedgehog`, slug: `zzretrotest-hedgehog-ra-${ID + 2}`, stub: true, platforms: ["Console 1"] });
    expect(await link(3)).toBeNull();
    const [a, b] = [await link(4), await link(5)];
    expect(a?.gameId).toBeDefined();
    expect(b?.gameId).toBeDefined();
    expect(a?.gameId).not.toBe(b?.gameId);
    expect(b?.game.platforms).toEqual(["Atari 2600"]);

    // Every row was looked at; the next run has nothing to do (the hack waits 30 days).
    expect(await prisma.retroCatalogGame.count({ where: { id: { gte: ID, lt: ID + 1000 }, matchedAt: null } })).toBe(0);
    await expect(linkRetroCatalog({ now: () => at })).resolves.toEqual({ linked: 0, created: 0, ambiguous: 0, skipped: 0 });
  });
});
