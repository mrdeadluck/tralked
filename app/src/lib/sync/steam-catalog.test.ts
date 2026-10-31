import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { IgdbApi, SgdbApi, SteamApi } from "@/lib/integrations";

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

const APP_BASE = 97_000_000;
/** The fixture app list's extra app (a second "Hollow Knight"). */
const DUPLICATE_NAME_APP = 2009195;
const CDN = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fake of the store, SteamSpy and the CDN for one app. */
function fakeNetwork(appId: number) {
  const calls: string[] = [];
  const politeFetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const u = new URL(url);
    if (u.hostname === "store.steampowered.com") {
      const id = Number(u.searchParams.get("appids"));
      if (id !== appId) return json({ [id]: { success: false } });
      return json({
        [id]: {
          success: true,
          data: {
            type: "game",
            name: "Farol Distante™",
            short_description: "Um <b>jogo</b> de exploração.",
            developers: ["Estúdio Exemplo"],
            publishers: ["Editora Exemplo"],
            release_date: { coming_soon: false, date: "24/fev./2017" },
            achievements: { total: 2 },
            header_image: `${CDN}/${id}/header.jpg`,
            screenshots: [{ path_full: `${CDN}/${id}/ss_1.1920x1080.jpg` }],
            movies: [],
          },
        },
      });
    }
    if (u.hostname === "steamspy.com") {
      if (u.searchParams.get("request") === "all") {
        return json({ [appId]: { appid: appId, name: "Farol", owners: "2,000,000 .. 5,000,000" } });
      }
      return json({ appid: appId, tags: { RPG: 900, Roguelike: 500 } });
    }
    // CDN: portrait cover and logo exist, the hero does not.
    if (url.endsWith("library_hero.jpg")) return new Response(null, { status: 404 });
    return new Response(null, { status: 200 });
  });
  return { politeFetch, calls };
}

const fakeSteam = (): SteamApi => ({
  async getPlayerSummary() {
    throw new Error("unused");
  },
  async getOwnedGames() {
    return "unsupported";
  },
  async getSchemaForGame() {
    return [
      { apiName: "A0", name: "Primeiro", hidden: false },
      { apiName: "A1", name: "Segundo", hidden: true },
    ];
  },
  async getGlobalAchievementPercentages() {
    return { A0: 50, A1: 2.5 };
  },
  async getPlayerAchievements() {
    return [];
  },
  async getWishlist() {
    return [];
  },
  async getAppList() {
    return "unsupported";
  },
});

const noIgdb: IgdbApi = {
  findBySteamAppId: async () => null,
  findByName: async () => null,
  getMedia: async () => ({ videos: [], screenshots: [], artworks: [] }),
};
const noSgdb: SgdbApi = { getArt: async () => ({}) };

describe.skipIf(!reachable)("steam catalog", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({
      where: { OR: [{ steamAppId: { gte: APP_BASE, lt: APP_BASE + 1000 } }, { steamAppId: DUPLICATE_NAME_APP }] },
    });
    await prisma.syncCursor.deleteMany({ where: { key: { in: ["steam-applist", "steamspy-popularity"] } } });
  }
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("imports the app list page by page as stubs, resumable and idempotent, then only changes", async () => {
    const { prisma } = await import("@/lib/db");
    const { createSteamFixture } = await import("@/lib/integrations/steam/fixture");
    const { importSteamAppList } = await import("./steam-catalog");
    const steam = createSteamFixture();
    const getAppList = vi.spyOn(steam, "getAppList");
    const hkBefore = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const count = () => prisma.game.count();
    const before = await count();

    // A deadline already passed reads nothing.
    expect(await importSteamAppList(0, { steam, now: () => 1 }, 4)).toMatchObject({ pages: 0 });

    let clock = 1_800_000_000_000;
    const now = () => clock;
    // One page per call: the cursor resumes where the last one stopped.
    const first = await importSteamAppList(clock + 2, { steam, now: () => (clock += 1) }, 4);
    expect(first).toMatchObject({ status: "ok", pages: 1, apps: 4, passDone: false });
    const rest = await importSteamAppList(clock + 1_000, { steam, now }, 4);
    expect(rest).toMatchObject({ pages: 2, apps: 6, passDone: true });

    // Only the app the catalog lacked was created; known games (seed, seeded stubs) are untouched.
    expect(await count()).toBe(before + 1);
    const duplicate = await prisma.game.findUniqueOrThrow({ where: { steamAppId: DUPLICATE_NAME_APP } });
    expect(duplicate).toMatchObject({ name: "Hollow Knight", slug: `hollow-knight-${DUPLICATE_NAME_APP}`, stub: true });
    expect(await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } })).toMatchObject({
      name: hkBefore.name,
      stub: false,
      updatedAt: hkBefore.updatedAt,
    });

    // The next pass asks only for apps changed since the last pass began.
    getAppList.mockClear();
    await importSteamAppList(clock + 1_000, { steam, now }, 100);
    expect(getAppList.mock.calls[0][0]).toMatchObject({ ifModifiedSince: Math.floor(1_800_000_000_000 / 1000) });
    expect(await count()).toBe(before + 1);
  });

  it("without an API key the app list is unsupported", async () => {
    const { importSteamAppList } = await import("./steam-catalog");
    expect(await importSteamAppList(Date.now() + 1000, { steam: fakeSteam(), now: Date.now })).toMatchObject({
      status: "unsupported",
      pages: 0,
    });
  });

  it("fetches store details of a requested stub: name, text, skills, achievements and checked CDN art", async () => {
    const { prisma } = await import("@/lib/db");
    const { ensureSteamGames } = await import("./steam-games");
    const { requestGameDetails, syncCatalogDetails } = await import("./steam-catalog");
    const appId = APP_BASE + 1;
    const ids = await ensureSteamGames([{ appId }]);
    const gameId = ids.get(appId)!;
    expect(await prisma.game.findUniqueOrThrow({ where: { id: gameId } })).toMatchObject({
      name: `Jogo ${appId} da Steam`,
      stub: true,
    });
    // Requested long ago: first in the queue whatever else is waiting.
    await requestGameDetails(gameId, new Date(0));

    const { politeFetch, calls } = fakeNetwork(appId);
    const result = await syncCatalogDetails(Date.now() + 60_000, {
      steam: fakeSteam(),
      politeFetch,
      igdb: noIgdb,
      sgdb: noSgdb,
      now: Date.now,
    }, 1);
    expect(result).toEqual({ processed: 1, failed: 0 });

    const game = await prisma.game.findUniqueOrThrow({
      where: { id: gameId },
      include: { skills: true, achievements: true, media: true },
    });
    expect(game).toMatchObject({
      name: "Farol Distante",
      stub: false,
      summary: "Um jogo de exploração.",
      developer: "Estúdio Exemplo",
      achievementCount: 2,
      coverUrl: `${CDN}/${appId}/library_600x900.jpg`,
      heroUrl: null,
      logoUrl: `${CDN}/${appId}/logo.png`,
      detailsRequestedAt: null,
    });
    expect(game.detailsSyncedAt).toBeInstanceOf(Date);
    expect(game.skills.map((s) => s.skill).sort()).toEqual(["roguelike", "rpg"]);
    expect(game.achievements.map((a) => [a.apiName, a.globalPct])).toEqual(
      expect.arrayContaining([["A0", 50], ["A1", 2.5]]),
    );
    expect(game.media.map((m) => m.kind).sort()).toEqual(["artwork", "cover", "logo", "screenshot"]);
    // Art was checked with HEAD before it was written; the store was read in pt-BR.
    expect(calls).toContain(`HEAD ${CDN}/${appId}/library_hero.jpg`);
    expect(calls.some((c) => c.includes("l=brazilian"))).toBe(true);
  });

  it("an app the store does not know is marked done and stays a stub", async () => {
    const { prisma } = await import("@/lib/db");
    const { ensureSteamGames } = await import("./steam-games");
    const { syncSteamDetails } = await import("./steam-catalog");
    const appId = APP_BASE + 2;
    await ensureSteamGames([{ appId, name: "Sumido" }]);
    const deps = { steam: fakeSteam(), politeFetch: fakeNetwork(APP_BASE + 999).politeFetch, igdb: noIgdb, sgdb: noSgdb, now: Date.now };
    expect(await syncSteamDetails(appId, deps)).toBe(false);
    expect(await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } })).toMatchObject({
      stub: true,
      name: "Sumido",
      detailsSyncedAt: expect.any(Date),
    });
  });

  it("sets popularity from a SteamSpy page and rotates the page", async () => {
    const { prisma } = await import("@/lib/db");
    const { ensureSteamGames } = await import("./steam-games");
    const { refreshPopularity } = await import("./steam-catalog");
    const appId = APP_BASE + 3;
    await ensureSteamGames([{ appId, name: "Popular" }]);
    const { politeFetch, calls } = fakeNetwork(appId);
    expect(await refreshPopularity(politeFetch)).toBe(1);
    expect((await prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } })).popularity).toBe(2_000_000);
    await refreshPopularity(politeFetch);
    expect(calls.map((c) => new URL(c.split(" ")[1]).searchParams.get("page"))).toEqual(["0", "1"]);
  });

  it("offline (fixtures) the job imports the app list and skips details", async () => {
    const { createSteamFixture } = await import("@/lib/integrations/steam/fixture");
    const { runSteamCatalogJob } = await import("./steam-catalog");
    const result = await runSteamCatalogJob(5_000, {
      steam: createSteamFixture(),
      politeFetch: null,
      igdb: noIgdb,
      sgdb: noSgdb,
      now: Date.now,
    });
    expect(result.details).toEqual({ processed: 0, failed: 0, skipped: "offline" });
    expect(result.appList.status).toBe("ok");
    expect(result.failed).toBe(0);
  });
});
