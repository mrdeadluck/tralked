import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { IgdbGame } from "@/lib/integrations";
import type { IgdbTimeToBeat } from "@/lib/integrations/igdb/types";
import type { IgdbCatalogApi, IgdbCatalogGame, IgdbCatalogQuery } from "@/lib/integrations/igdb/catalog-types";

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

const IGDB = 96_600_000;
const APP = 96_600_000;
const sec = (y: number) => Date.UTC(y, 5, 1) / 1000;

const g = (id: number, name: string, platforms: number[], extra: Partial<IgdbCatalogGame> = {}): IgdbCatalogGame => ({
  igdbId: IGDB + id,
  name,
  platforms,
  steamAppIds: [],
  popularity: 0,
  ...extra,
});

function fakeIgdb(
  games: IgdbCatalogGame[],
  details: Record<number, Partial<IgdbGame>> = {},
  times: Record<number, IgdbTimeToBeat> = {},
) {
  const calls: IgdbCatalogQuery[] = [];
  const api: IgdbCatalogApi = {
    getReleaseDates: async () => [],
    async listGames(query) {
      calls.push(query);
      if (query.updatedSince !== undefined) return { games: [], rawCount: 0, lastId: 0 };
      const page = games.filter((x) => x.igdbId > query.afterId).sort((a, b) => a.igdbId - b.igdbId).slice(0, query.limit);
      return { games: page, rawCount: page.length, lastId: page.at(-1)?.igdbId ?? 0 };
    },
    async getGames(ids) {
      return ids.flatMap((id) => {
        const base = games.find((x) => x.igdbId === id);
        const extra = details[id];
        if (!base || !extra) return [];
        return [{ igdbId: id, name: base.name, genres: [], themes: [], gameModes: [], perspectives: [], keywords: [], ...extra }];
      });
    },
    findPlatformIds: async () => [],
    getTimesToBeat: async (ids) => new Map(ids.filter((id) => times[id]).map((id) => [id, times[id]])),
  };
  return { api, calls };
}

describe.skipIf(!reachable)("IGDB console catalog", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({
      where: { OR: [{ igdbId: { gte: IGDB, lt: IGDB + 1000 } }, { steamAppId: { gte: APP, lt: APP + 1000 } }, { slug: { startsWith: "igdbt-" } }] },
    });
    await prisma.syncCursor.deleteMany({ where: { key: "igdb-catalog" } });
  }
  beforeAll(cleanup);
  afterAll(cleanup);

  it("reads the three IGDB times to beat in bulk, marks every game asked and keeps times IGDB leaves out", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncTimesToBeat } = await import("./igdb-catalog");
    const timed = await prisma.game.create({
      data: { slug: "igdbt-tempo", name: "Igdbt Tempo", igdbId: IGDB + 900, platforms: ["PS5"], achievementCount: 0, popularity: 1e9, timeToBeatCompleteMin: 999 },
    });
    const partial = await prisma.game.create({
      data: { slug: "igdbt-tempo-parcial", name: "Igdbt Parcial", igdbId: IGDB + 901, platforms: ["PS5"], achievementCount: 0, popularity: 1e9 - 1, timeToBeatCompleteMin: 600 },
    });
    const none = await prisma.game.create({
      data: { slug: "igdbt-sem-tempo", name: "Igdbt Sem Tempo", igdbId: IGDB + 902, platforms: ["PS5"], achievementCount: 0, popularity: 1e9 - 2 },
    });
    const { api } = fakeIgdb([], {}, {
      [IGDB + 900]: { hastily: 3 * 3600, normally: 6 * 3600, completely: 12 * 3600 },
      [IGDB + 901]: { normally: 5 * 3600 },
    });
    const now = new Date();
    expect(await syncTimesToBeat(api, now, 3)).toBe(2);
    const read = async (id: string) =>
      prisma.game.findUniqueOrThrow({
        where: { id },
        select: { timeToBeatHastyMin: true, timeToBeatNormalMin: true, timeToBeatCompleteMin: true, timeToBeatCheckedAt: true },
      });
    expect(await read(timed.id)).toEqual({ timeToBeatHastyMin: 180, timeToBeatNormalMin: 360, timeToBeatCompleteMin: 720, timeToBeatCheckedAt: now });
    expect(await read(partial.id)).toEqual({ timeToBeatHastyMin: null, timeToBeatNormalMin: 300, timeToBeatCompleteMin: 600, timeToBeatCheckedAt: now });
    expect(await read(none.id)).toEqual({ timeToBeatHastyMin: null, timeToBeatNormalMin: null, timeToBeatCompleteMin: null, timeToBeatCheckedAt: now });
  });

  it("imports pages as stubs, resumes from the cursor and matches existing games without duplicates", async () => {
    const { prisma } = await import("@/lib/db");
    const { importIgdbCatalog } = await import("./igdb-catalog");
    // Already in the catalog: a Steam game (matched by appid), a listed game by name, two namesakes.
    const steamGame = await prisma.game.create({
      data: { slug: "igdbt-steam", name: "Igdbt Vapor Game", steamAppId: APP + 1, platforms: ["PC"], achievementCount: 3 },
    });
    const byName = await prisma.game.create({
      data: { slug: "igdbt-nome", name: "Igdbt Mesmo Nome", platforms: ["PC"], achievementCount: 0, releaseDate: new Date(Date.UTC(2004, 0, 1)) },
    });
    await prisma.game.createMany({
      data: [
        { slug: "igdbt-ambiguo-1", name: "Igdbt Ambíguo", platforms: ["PC"], achievementCount: 0 },
        { slug: "igdbt-ambiguo-2", name: "Igdbt Ambíguo", platforms: ["PC"], achievementCount: 0 },
        { slug: "igdbt-remake", name: "Igdbt Clássico", platforms: ["PC"], achievementCount: 0, releaseDate: new Date(Date.UTC(2020, 0, 1)) },
      ],
    });
    const games = [
      g(1, "Igdbt Vapor Game (console)", [6, 48], { steamAppIds: [APP + 1] }),
      // Case and trademark signs do not matter.
      g(2, "igdbt mesmo nome™", [8], { firstReleaseDate: sec(2004) }),
      // Two PC games of this name (no dates) could both be it: skipped.
      g(3, "Igdbt Ambíguo", [7, 6]),
      // Same name as a 2020 game, but from 1998: a different game.
      g(4, "Igdbt Clássico", [7], { firstReleaseDate: sec(1998) }),
      g(5, "Igdbt Só no Console", [130, 4], { firstReleaseDate: sec(2017), coverImageId: "co5abc" }),
      // A Steam appid the catalog does not have yet: becomes a Steam stub (found later by the app list).
      g(6, "Igdbt Novo na Steam", [6], { steamAppIds: [APP + 6] }),
      // God of War on PS2 (2005) is not the Steam "God of War" stub (no date): no shared family.
      g(7, "Igdbt Deus da Guerra", [8], { firstReleaseDate: sec(2005) }),
      // A listed console game without a date, same name and family: the same game.
      g(8, "Igdbt Console Sem Data", [167]),
      // On PC too, but IGDB knows no Steam appid: an IGDB stub the Steam import adopts later.
      g(9, "Igdbt Também no PC", [6, 48]),
    ];
    const godOfWarSteam = await prisma.game.create({
      data: { slug: "igdbt-deus-steam", name: "Igdbt Deus da Guerra", steamAppId: APP + 7, platforms: ["PC"], achievementCount: 0, stub: true },
    });
    const consoleNoDate = await prisma.game.create({
      data: { slug: "igdbt-console", name: "Igdbt Console Sem Data", platforms: ["PS5"], achievementCount: 0 },
    });
    const { api, calls } = fakeIgdb(games);
    // Each clock read advances it: with a deadline of 2 a run has time for exactly one page.
    const ticking = () => {
      let t = 0;
      return () => t++;
    };
    const first = await importIgdbCatalog(api, 2, ticking(), 5);
    expect(first).toMatchObject({ pages: 1, games: 5, passDone: false });
    expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: "igdb-catalog" } })).value).toMatchObject({ lastId: IGDB + 5, since: null });
    const second = await importIgdbCatalog(api, 2, ticking(), 5);
    expect(second).toMatchObject({ pages: 1, games: 4, passDone: true });
    expect(calls[1].afterId).toBe(IGDB + 5);
    // A finished pass: the next one asks only for changes.
    await importIgdbCatalog(api, 2, ticking(), 5);
    expect(calls[2]).toMatchObject({ afterId: 0, updatedSince: expect.any(Number) });

    const steam = await prisma.game.findUniqueOrThrow({ where: { id: steamGame.id } });
    expect(steam).toMatchObject({ igdbId: IGDB + 1, name: "Igdbt Vapor Game" });
    expect(steam.platforms).toEqual(["PC", "PLAYSTATION"]);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: byName.id } })).igdbId).toBe(IGDB + 2);
    expect(await prisma.game.count({ where: { igdbId: IGDB + 3 } })).toBe(0);
    const remake = await prisma.game.findMany({ where: { igdbId: IGDB + 4 } });
    expect(remake).toEqual([expect.objectContaining({ slug: "igdbt-classico", stub: true, platforms: ["PLAYSTATION"] })]);
    const consoleOnly = await prisma.game.findFirstOrThrow({ where: { igdbId: IGDB + 5 } });
    expect(consoleOnly).toMatchObject({
      slug: "igdbt-so-no-console",
      stub: true,
      steamAppId: null,
      platforms: ["NINTENDO"],
      releaseDate: new Date(sec(2017) * 1000),
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co5abc.jpg",
    });
    const newSteam = await prisma.game.findUniqueOrThrow({ where: { steamAppId: APP + 6 } });
    expect(newSteam).toMatchObject({ igdbId: IGDB + 6, stub: true });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: godOfWarSteam.id } })).igdbId).toBeNull();
    expect(await prisma.game.findMany({ where: { igdbId: IGDB + 7 } })).toEqual([
      expect.objectContaining({ slug: `igdbt-deus-da-guerra`, steamAppId: null, platforms: ["PLAYSTATION"], stub: true }),
    ]);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: consoleNoDate.id } })).igdbId).toBe(IGDB + 8);
    expect(await prisma.game.count({ where: { igdbId: IGDB + 8 } })).toBe(1);

    // Running the whole list again creates nothing new.
    await prisma.syncCursor.deleteMany({ where: { key: "igdb-catalog" } });
    const before = await prisma.game.count();
    const again = await importIgdbCatalog(api, 2, ticking(), 100);
    expect(again.created).toBe(0);
    expect(await prisma.game.count()).toBe(before);
  });

  it("the Steam import gives an IGDB stub on PC its appid instead of adding the game twice", async () => {
    const { prisma } = await import("@/lib/db");
    const { ensureSteamGames } = await import("./steam-games");
    const igdbStub = await prisma.game.findFirstOrThrow({ where: { igdbId: IGDB + 9 } });
    expect(igdbStub).toMatchObject({ steamAppId: null, stub: true, platforms: ["PC", "PLAYSTATION"] });
    const before = await prisma.game.count();
    const ids = await ensureSteamGames([
      // Same name, other case: adopted.
      { appId: APP + 9, name: "igdbt também no pc" },
      // An IGDB stub that is not on PC is never adopted: a new Steam row.
      { appId: APP + 5, name: "Igdbt Só no Console" },
      // Nothing of this name: a new Steam row, as before.
      { appId: APP + 10, name: "Igdbt Só na Steam" },
    ]);
    expect(ids.get(APP + 9)).toBe(igdbStub.id);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: igdbStub.id } })).steamAppId).toBe(APP + 9);
    expect(ids.get(APP + 5)).not.toBe((await prisma.game.findFirstOrThrow({ where: { igdbId: IGDB + 5 } })).id);
    expect(await prisma.game.count()).toBe(before + 2);
    // Idempotent: the next import finds them all by appid.
    expect(await ensureSteamGames([{ appId: APP + 9, name: "Igdbt Também no PC" }, { appId: APP + 10, name: "Igdbt Só na Steam" }])).toEqual(
      new Map([
        [APP + 9, igdbStub.id],
        [APP + 10, ids.get(APP + 10)],
      ]),
    );
    expect(await prisma.game.count()).toBe(before + 2);
  });

  it("adopts listed IGDB games too (queued for Steam details), never a name other games share, accents via SQL lower()", async () => {
    const { prisma } = await import("@/lib/db");
    const { ensureSteamGames } = await import("./steam-games");
    const syncedAt = new Date(Date.UTC(2030, 0, 1));
    // Already out of the stub state (the IGDB details step lists ~4k games an hour).
    const listed = await prisma.game.create({
      data: { slug: "igdbt-listado", name: "Igdbt Listado no PC", igdbId: IGDB + 40, platforms: ["PC", "XBOX"], achievementCount: 0, stub: false, detailsSyncedAt: syncedAt },
    });
    // A generic name: an IGDB game on PC, plus another catalog game of the same name.
    const chess = await prisma.game.create({
      data: { slug: "igdbt-xadrez-igdb", name: "Igdbt Xadrez", igdbId: IGDB + 41, platforms: ["PC"], achievementCount: 0, stub: true },
    });
    await prisma.game.create({ data: { slug: "igdbt-xadrez-outro", name: "igdbt xadrez", platforms: ["NINTENDO"], achievementCount: 0 } });
    // Accented name, other case on the Steam side: Postgres lower() folds both the same way.
    const accented = await prisma.game.create({
      data: { slug: "igdbt-eter", name: "Igdbt Éter Órbita", igdbId: IGDB + 42, platforms: ["PC"], achievementCount: 0, stub: true },
    });
    const ids = await ensureSteamGames([
      { appId: APP + 40, name: "Igdbt Listado no PC" },
      { appId: APP + 41, name: "Igdbt Xadrez" },
      { appId: APP + 42, name: "IGDBT ÉTER ÓRBITA" },
    ]);
    expect(ids.get(APP + 40)).toBe(listed.id);
    expect(await prisma.game.findUniqueOrThrow({ where: { id: listed.id } })).toMatchObject({ steamAppId: APP + 40, detailsSyncedAt: null, stub: false });
    expect(ids.get(APP + 41)).not.toBe(chess.id);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: chess.id } })).steamAppId).toBeNull();
    expect(ids.get(APP + 42)).toBe(accented.id);
  });

  it("matches IGDB names with accents and case through SQL lower(), also when re-checked under the lock", async () => {
    const { prisma } = await import("@/lib/db");
    const { resolveIgdbGames } = await import("./igdb-games");
    const known = await prisma.game.create({
      data: { slug: "igdbt-acento", name: "igdbt ação élfica", platforms: ["PLAYSTATION"], achievementCount: 0 },
    });
    const result = await resolveIgdbGames([g(50, "IGDBT AÇÃO ÉLFICA™", [48])]);
    expect(result.ids.get(IGDB + 50)).toBe(known.id);
    expect(result.created).toBe(0);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: known.id } })).igdbId).toBe(IGDB + 50);
  });

  it("a Steam import and an IGDB import of the same new PC game at once leave one row", async () => {
    const { prisma } = await import("@/lib/db");
    const { resolveIgdbGames } = await import("./igdb-games");
    const { ensureSteamGames } = await import("./steam-games");
    for (let i = 0; i < 5; i++) {
      const name = `Igdbt Corrida Simultânea ${i}`;
      await Promise.all([
        ensureSteamGames([{ appId: APP + 60 + i, name }]),
        resolveIgdbGames([g(60 + i, name, [6, 48])]),
      ]);
      expect(await prisma.game.count({ where: { name: { equals: name, mode: "insensitive" } } })).toBe(1);
    }
  });

  it("fills IGDB stubs' details, opened ones first, and lists them", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncIgdbDetails } = await import("./igdb-catalog");
    const consoleOnly = await prisma.game.findFirstOrThrow({ where: { igdbId: IGDB + 5 } });
    const remake = await prisma.game.findFirstOrThrow({ where: { igdbId: IGDB + 4 } });
    await prisma.game.update({ where: { id: remake.id }, data: { detailsRequestedAt: new Date(0) } });
    const { api } = fakeIgdb(
      [g(4, "Igdbt Clássico", [7]), g(5, "Igdbt Só no Console", [130])],
      { [IGDB + 5]: { summary: "Um jogo de console.", genres: ["Platform"], aggregatedRating: 81.6, coverImageId: "coNEW" } },
    );
    const result = await syncIgdbDetails(api, new Date(), 1);
    // Batch of one: the requested game goes first; IGDB no longer knows it, so it stays a stub.
    expect(result).toEqual({ processed: 0, missing: 1 });
    expect(await prisma.game.findUniqueOrThrow({ where: { id: remake.id } })).toMatchObject({ stub: true, detailsRequestedAt: null });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: remake.id } })).detailsSyncedAt).not.toBeNull();

    // Steam stubs are left to the Steam details job.
    const next = await syncIgdbDetails(api, new Date(), 500);
    expect(next.processed).toBeGreaterThanOrEqual(1);
    const listed = await prisma.game.findUniqueOrThrow({ where: { id: consoleOnly.id }, include: { skills: true } });
    expect(listed).toMatchObject({ stub: false, summary: "Um jogo de console.", criticScore: 82 });
    // The import's cover stays (only blanks are filled).
    expect(listed.coverUrl).toContain("co5abc");
    expect(listed.skills.length).toBeGreaterThan(0);
    expect((await prisma.game.findUniqueOrThrow({ where: { steamAppId: APP + 6 } })).detailsSyncedAt).toBeNull();
  });

  it("does nothing without IGDB (production without credentials)", async () => {
    const { runIgdbCatalogJob } = await import("./igdb-catalog");
    expect(await runIgdbCatalogJob(1_000, { igdb: null, now: Date.now })).toEqual({ processed: 0, failed: 0, status: "disabled" });
  });
});
