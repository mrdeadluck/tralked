import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { IgdbCatalogApi, IgdbCatalogGame, IgdbReleaseDate, IgdbReleaseQuery } from "@/lib/integrations/igdb/catalog-types";
import type { SteamReleaseItem, SteamReleaseList } from "@/lib/integrations/steam/releases";

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

const APP = 96_500_000;
const IGDB = 96_500_000;
const DAY = 86_400_000;
// A fixed "now" far from the seed's data: releases are read around it.
const NOW = Date.UTC(2038, 4, 15, 15);
const day = (offset: number) => new Date(Date.UTC(2038, 4, 15) + offset * DAY);

const steamLists = (lists: Partial<Record<SteamReleaseList, SteamReleaseItem[]>>) => async (list: SteamReleaseList, start: number) =>
  start === 0 ? (lists[list] ?? []) : [];

const game = (id: number, name: string, platforms: number[], extra: Partial<IgdbCatalogGame> = {}): IgdbCatalogGame => ({
  igdbId: IGDB + id,
  name,
  platforms,
  steamAppIds: [],
  popularity: 10,
  ...extra,
});

/** A fake IGDB that honors the query (platforms, window, order, popularity) and records it. */
function fakeIgdb(releases: IgdbReleaseDate[], queries: IgdbReleaseQuery[] = []): IgdbCatalogApi {
  return {
    async getReleaseDates(query) {
      queries.push(query);
      const wanted = new Set(query.platforms);
      return releases
        .filter((r) => wanted.has(r.platform) && r.date !== undefined && r.date >= query.from && r.date < query.to)
        .filter((r) => !query.popularOnly || r.game.popularity > 0)
        .sort((a, b) => (query.order === "desc" ? b.date! - a.date! : a.date! - b.date!))
        .slice(query.offset, query.offset + query.limit);
    },
    listGames: async () => ({ games: [], rawCount: 0, lastId: 0 }),
    getGames: async () => [],
    findPlatformIds: async () => [],
    getTimesToBeat: async () => new Map(),
  };
}

const sec = (d: Date) => d.getTime() / 1000;

describe.skipIf(!reachable)("releases job", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({
      where: {
        OR: [
          { steamAppId: { gte: APP, lt: APP + 1000 } },
          { igdbId: { gte: IGDB, lt: IGDB + 1000 } },
          { slug: { startsWith: "rel-test-" } },
        ],
      },
    });
  }
  beforeAll(cleanup);
  afterAll(cleanup);

  it("writes Steam's lists as PC releases, creating stubs once and queueing their details", async () => {
    const { prisma } = await import("@/lib/db");
    const { runReleasesJob } = await import("./releases");
    const deps = {
      steamList: steamLists({
        popularnew: [
          { appId: APP + 1, name: "Rel Test Novo", date: day(-3), position: 0, imageUrl: "https://shared.fastly.steamstatic.com/a.jpg" },
          // An old game in "popular new" (an update): not a release.
          { appId: APP + 2, name: "Rel Test Antigo", date: day(-400), position: 1 },
        ],
        popularcomingsoon: [
          { appId: APP + 3, name: "Rel Test Em Breve", date: day(10), position: 0 },
          { appId: APP + 4, name: "Rel Test Sem Data", dateLabel: "4º trimestre de 2038", position: 1 },
        ],
      }),
      igdb: null,
      now: () => NOW,
    };
    const first = await runReleasesJob(10_000, deps);
    expect(first.steam).toMatchObject({ items: 3, failed: 0 });
    expect(first.igdb.status).toBe("disabled");
    await runReleasesJob(10_000, deps);

    const games = await prisma.game.findMany({
      where: { steamAppId: { gte: APP, lt: APP + 10 } },
      include: { releases: true },
      orderBy: { steamAppId: "asc" },
    });
    expect(games.map((g) => g.steamAppId)).toEqual([APP + 1, APP + 3, APP + 4]);
    expect(games.every((g) => g.stub && g.detailsRequestedAt !== null)).toBe(true);
    expect(games.map((g) => g.releases.length)).toEqual([1, 1, 1]);
    expect(games[0].releases[0]).toMatchObject({ platform: "PC", source: "steam", date: day(-3), score: 1000 });
    expect(games[0].releases[0].imageUrl).toContain("steamstatic");
    expect(games[2].releases[0]).toMatchObject({ date: null, dateLabel: "4º trimestre de 2038" });
  });

  it("matches IGDB releases to the catalog (Steam appid, IGDB id), never duplicating a game; Steam keeps PC", async () => {
    const { prisma } = await import("@/lib/db");
    const { runReleasesJob } = await import("./releases");
    const known = await prisma.game.create({
      data: { slug: "rel-test-conhecido", name: "Rel Test Conhecido", igdbId: IGDB + 20, platforms: ["PC"], achievementCount: 0 },
    });
    const steamGame = game(1, "Rel Test Novo (IGDB)", [6, 167], { steamAppIds: [APP + 1], popularity: 70 });
    const releases: IgdbReleaseDate[] = [
      // PC row of a game Steam already listed: IGDB is not even asked for PC.
      { id: 1, platform: 6, date: sec(day(-1)), precision: "day", game: steamGame },
      // Its PS5 release: a new row on the same game.
      { id: 2, platform: 167, date: sec(day(5)), precision: "day", game: steamGame },
      // Same game, other region, later: the earliest exact day wins.
      { id: 3, platform: 167, date: sec(day(9)), precision: "day", game: steamGame },
      { id: 4, platform: 130, date: sec(day(20)), precision: "day", game: game(20, "Rel Test Conhecido", [130]) },
      { id: 5, platform: 169, date: sec(day(40)), precision: "q1", game: game(30, "Rel Test Console Novo", [169, 49]) },
      // Past releases come from their own (walking back) window.
      { id: 6, platform: 48, date: sec(day(-6)), precision: "day", game: game(33, "Rel Test Console Antigo", [48]) },
      // TBD, games nobody follows and unknown platforms are skipped.
      { id: 7, platform: 169, date: sec(day(12)), precision: "tbd", game: game(31, "Rel Test TBD", [169]) },
      { id: 8, platform: 169, date: sec(day(12)), precision: "day", game: game(34, "Rel Test Ninguém Segue", [169], { popularity: 0 }) },
      { id: 9, platform: 9999, date: sec(day(3)), precision: "day", game: game(32, "Rel Test Outro", [9999]) },
    ];
    const queries: IgdbReleaseQuery[] = [];
    const deps = { steamList: steamLists({}), igdb: fakeIgdb(releases, queries), now: () => NOW };
    const result = await runReleasesJob(10_000, deps);
    expect(result.igdb).toMatchObject({ status: "ok", releases: 4, failed: 0 });
    // Per console family, a past window walking back and an upcoming one walking forward; never PC.
    expect(queries).toHaveLength(6);
    expect(queries.every((q) => q.popularOnly && !q.platforms.includes(6))).toBe(true);
    expect(queries.filter((q) => q.order === "desc").every((q) => q.to <= sec(day(1)) && q.from === sec(day(-30)))).toBe(true);
    expect(queries.filter((q) => q.order === "asc").every((q) => q.from === sec(day(1)))).toBe(true);
    expect(new Set(queries.map((q) => q.platforms.join(","))).size).toBe(3);
    await runReleasesJob(10_000, deps);

    const steam = await prisma.game.findUniqueOrThrow({ where: { steamAppId: APP + 1 }, include: { releases: { orderBy: { platform: "asc" } } } });
    expect(steam.igdbId).toBe(IGDB + 1);
    expect(steam.platforms.sort()).toEqual(["PC", "PLAYSTATION"]);
    expect(steam.releases.map((r) => [r.platform, r.source, r.date?.toISOString()])).toEqual([
      ["PC", "steam", day(-3).toISOString()],
      ["PLAYSTATION", "igdb", day(5).toISOString()],
    ]);
    const knownReleases = await prisma.gameRelease.findMany({ where: { gameId: known.id } });
    expect(knownReleases).toEqual([expect.objectContaining({ platform: "NINTENDO", source: "igdb" })]);
    expect(await prisma.game.count({ where: { igdbId: IGDB + 20 } })).toBe(1);

    const created = await prisma.game.findMany({ where: { igdbId: IGDB + 30 }, include: { releases: true } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ stub: true, name: "Rel Test Console Novo", platforms: ["XBOX"] });
    expect(created[0].releases[0]).toMatchObject({ platform: "XBOX", date: null, dateLabel: "1º trimestre de 2038" });
    expect(await prisma.game.count({ where: { igdbId: { in: [IGDB + 31, IGDB + 32, IGDB + 34] } } })).toBe(0);
    const past = await prisma.game.findFirstOrThrow({ where: { igdbId: IGDB + 33 }, include: { releases: true } });
    expect(past.releases).toEqual([expect.objectContaining({ platform: "PLAYSTATION", date: day(-6) })]);
  });

  it("lists Últimos and Próximos around today, each game once", async () => {
    const { listReleases, getReleasesCard } = await import("@/lib/queries/releases");
    const now = new Date(NOW);
    const ultimos = (await listReleases("ultimos", now)).filter((r) => r.name.startsWith("Rel Test"));
    expect(ultimos.map((r) => r.name)).toEqual(["Rel Test Novo", "Rel Test Console Antigo"]);
    // Only the platforms released inside the window (its PS5 release is still ahead).
    expect(ultimos[0].platforms).toEqual(["PC"]);
    expect(ultimos[0].relative).toBe("há 3 dias");
    const proximos = (await listReleases("proximos", now)).filter((r) => r.name.startsWith("Rel Test"));
    expect(proximos.map((r) => r.name)).toEqual(["Rel Test Novo", "Rel Test Em Breve", "Rel Test Conhecido", "Rel Test Sem Data", "Rel Test Console Novo"]);
    expect(proximos[0].day).toBe(day(5).toISOString().slice(0, 10));
    const nintendo = (await listReleases("proximos", now, "NINTENDO")).filter((r) => r.name.startsWith("Rel Test"));
    expect(nintendo.map((r) => r.name)).toEqual(["Rel Test Conhecido"]);
    // Upcoming releases no source listed for two weeks drop out, dated or not.
    const later = new Date(NOW + 20 * DAY);
    const stale = (await listReleases("proximos", later)).map((r) => r.name);
    expect(stale).not.toContain("Rel Test Sem Data");
    expect(stale).not.toContain("Rel Test Console Novo");

    const card = await getReleasesCard(now, 50);
    expect(card.tabs.proximos.PC.some((r) => r.name === "Rel Test Em Breve")).toBe(true);
    expect(card.tabs.proximos.PC.some((r) => r.name === "Rel Test Conhecido")).toBe(false);
    expect(card.tabs.proximos.TODAS.some((r) => r.name === "Rel Test Conhecido")).toBe(true);
  });

  it("Últimos only lists releases a source vouched for on or after the day", async () => {
    const { prisma } = await import("@/lib/db");
    const { listReleases } = await import("@/lib/queries/releases");
    const delayed = await prisma.game.create({
      data: { slug: "rel-test-adiado", name: "Rel Test Adiado", platforms: ["PC"], achievementCount: 0, stub: true },
    });
    // Last seen as upcoming five days ago, for two days ago; nobody listed it since.
    await prisma.gameRelease.create({
      data: { gameId: delayed.id, platform: "PC", date: day(-2), source: "steam", score: 5, seenAt: new Date(NOW - 5 * DAY) },
    });
    const names = (await listReleases("ultimos", new Date(NOW))).map((r) => r.name);
    expect(names).not.toContain("Rel Test Adiado");
    await prisma.gameRelease.update({
      where: { gameId_platform: { gameId: delayed.id, platform: "PC" } },
      data: { seenAt: new Date(NOW) },
    });
    expect((await listReleases("ultimos", new Date(NOW))).map((r) => r.name)).toContain("Rel Test Adiado");
  });

  it("a busy family never pushes another out of a filtered list (over 400 rows)", async () => {
    const { prisma } = await import("@/lib/db");
    const { getReleasesCard, LIST_LIMIT, listReleases } = await import("@/lib/queries/releases");
    const count = LIST_LIMIT + 20;
    await prisma.game.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        slug: `rel-test-massa-${i}`,
        name: `Rel Test Massa ${i}`,
        platforms: ["PC"],
        achievementCount: 0,
        stub: true,
      })),
    });
    const crowd = await prisma.game.findMany({ where: { slug: { startsWith: "rel-test-massa-" } }, select: { id: true } });
    await prisma.gameRelease.createMany({
      data: crowd.map((g, i) => ({ gameId: g.id, platform: "PC", date: day(3 + (i % 20)), source: "steam", score: 5_000 + i, seenAt: new Date(NOW) })),
    });
    const quiet = await prisma.game.create({
      data: { slug: "rel-test-quieto", name: "Rel Test Quieto", platforms: ["NINTENDO"], achievementCount: 0, stub: true },
    });
    await prisma.gameRelease.create({
      data: { gameId: quiet.id, platform: "NINTENDO", date: day(4), source: "igdb", score: 1, seenAt: new Date(NOW) },
    });
    const now = new Date(NOW);
    expect((await listReleases("proximos", now, "NINTENDO")).map((r) => r.name)).toContain("Rel Test Quieto");
    expect((await getReleasesCard(now, 6)).tabs.proximos.NINTENDO.map((r) => r.name)).toContain("Rel Test Quieto");
    // The unfiltered list is capped at the most popular games.
    expect((await listReleases("proximos", now)).length).toBeLessThanOrEqual(LIST_LIMIT);
    await prisma.game.deleteMany({ where: { slug: { startsWith: "rel-test-massa-" } } });
  });

  it("an IGDB failure leaves the Steam part done", async () => {
    const { runReleasesJob } = await import("./releases");
    const broken: IgdbCatalogApi = { ...fakeIgdb([]), getReleaseDates: async () => Promise.reject(new Error("boom")) };
    const result = await runReleasesJob(10_000, {
      steamList: steamLists({ popularnew: [{ appId: APP + 5, name: "Rel Test Outro Novo", date: day(-1), position: 0 }] }),
      igdb: broken,
      now: () => NOW,
    });
    expect(result.steam.items).toBe(1);
    // Each family and window fails on its own (3 × 2), and the others are still asked.
    expect(result.igdb.failed).toBe(6);
  });
});
