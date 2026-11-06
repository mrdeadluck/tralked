import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnTrophy } from "@/lib/integrations/psn/types";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable. No Sony call is made:
// the list-definitions call is a stub.
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

import { PSN_OPEN_BUDGET_KEY, PSN_OPEN_COOLDOWN_KEY, PSN_SCAN_COOLDOWN_KEY } from "./psn-catalog-trophies";

const reachable = await databaseReachable();
const LIST = "NPWR98001_00";
const OTHER = "NPWR98002_00";
const SLUG = "zzpsnopen-game";
const HANDLE = "test_psnopen";
const ACCOUNT = "9000000000000000002"; // the PSN fixture's public test account

const trophy = (id: number, tier: PsnTrophy["tier"], over: Partial<PsnTrophy> = {}): PsnTrophy => ({
  trophyId: String(id),
  name: `Troféu ${id}`,
  description: `Faça ${id}`,
  iconUrl: `https://image.api.playstation.com/trophy/np/${LIST}_00AA${id}.PNG`,
  hidden: false,
  tier,
  earned: false,
  earnedAt: null,
  rarityPct: null,
  ...over,
});
const DEFINITIONS = [trophy(0, "platinum"), trophy(1, "gold"), trophy(2, "bronze")];
// What the catalog says of the list: 1 platinum, 1 gold, 1 bronze.
const HOUR = 3_600_000;
const COUNTS: [number, number, number, number] = [1, 0, 1, 1];

function fakeApi(answer: () => Promise<PsnTrophy[] | null> = async () => DEFINITIONS) {
  const calls: string[] = [];
  return {
    calls,
    async getListTrophies(npTitleId: string) {
      calls.push(npTitleId);
      // Icons name the list asked, as Sony's do.
      return (await answer())?.map((t) => ({ ...t, iconUrl: t.iconUrl?.replace(LIST, npTitleId) ?? null })) ?? null;
    },
  };
}

describe.skipIf(!reachable)("PSN trophies read when the page opens", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.psnCatalogList.deleteMany({ where: { id: { in: [LIST, OTHER] } } });
    await prisma.syncCursor.deleteMany({ where: { key: { in: [PSN_OPEN_BUDGET_KEY, PSN_OPEN_COOLDOWN_KEY, PSN_SCAN_COOLDOWN_KEY] } } });
  }

  /** A game with the catalog lists (as matchPsnCatalog leaves them: TrophyList without trophies, plus the link). */
  async function seed(ids: string[] = [LIST]) {
    const { prisma } = await import("@/lib/db");
    const { ensureTrophyList } = await import("@/lib/trophies/lists");
    const game = await prisma.game.create({ data: { slug: SLUG, name: "Zz Psn Open", platforms: ["PLAYSTATION"], achievementCount: 0 } });
    const [bronze, silver, gold, platinum] = COUNTS;
    for (const id of ids) {
      await prisma.psnCatalogList.create({
        data: { id, name: "Zz Psn Open", console: "PS5", serviceName: "trophy2", trophyCount: 3, tiers: { bronze, silver, gold, platinum }, matchedAt: new Date() },
      });
      await ensureTrophyList(prisma, { gameId: game.id, platform: "psn", externalId: id, console: "PS5", name: "Zz Psn Open", serviceName: "trophy2", trophyCount: 3 });
      await prisma.gamePlatformLink.create({ data: { gameId: game.id, platform: "psn", externalId: id } });
    }
    return game;
  }

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("first open reads the definitions once", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const api = fakeApi();

    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("loaded");
    expect(api.calls).toEqual([LIST]);
    const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "psn", externalId: LIST } } });
    const rows = await prisma.achievement.findMany({ where: { listId: list.id }, orderBy: { apiName: "asc" } });
    expect(rows.map((r) => [r.apiName, r.trophyTier, r.gameId, r.platform, r.globalPct])).toEqual([
      ["0", "platinum", game.id, "psn", null],
      ["1", "gold", game.id, "psn", null],
      ["2", "bronze", game.id, "psn", null],
    ]);
    expect(rows[0]).toMatchObject({ name: "Troféu 0", description: "Faça 0", hidden: false });
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesSyncedAt).not.toBeNull();

    // The next open finds it read: no call, nothing new.
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("none");
    expect(api.calls).toHaveLength(1);
    expect(await prisma.achievement.count({ where: { listId: list.id } })).toBe(3);
  });

  it("concurrent opens read once", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const api = fakeApi(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return DEFINITIONS;
    });

    const results = await Promise.all(Array.from({ length: 5 }, () => loadPsnCatalogTrophies(game.id, api)));
    expect(api.calls).toHaveLength(1);
    expect(results.filter((r) => r === "loaded")).toHaveLength(1);
    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(3);
  });

  it("a later player sync fills the same list without duplicating rows", async () => {
    const { prisma } = await import("@/lib/db");
    const { getPsn } = await import("@/lib/integrations");
    const { syncPlatformAccount } = await import("./platform-user");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    await loadPsnCatalogTrophies(game.id, fakeApi());
    const before = await prisma.achievement.findMany({ where: { gameId: game.id }, orderBy: { apiName: "asc" } });

    const psn = getPsn();
    const earnedAt = new Date("2026-03-01T20:00:00Z");
    const titles = vi.spyOn(psn, "getTitles").mockResolvedValue([
      {
        npTitleId: LIST,
        serviceName: "trophy2",
        name: "Zz Psn Open",
        platform: "PS5",
        progress: 33,
        trophyCounts: { bronze: 1, silver: 0, gold: 1, platinum: 1 },
        earnedCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
        lastPlayed: earnedAt,
      },
    ]);
    const trophies = vi.spyOn(psn, "getTrophies").mockResolvedValue(
      DEFINITIONS.map((t) => ({ ...t, earned: t.trophyId === "2", earnedAt: t.trophyId === "2" ? earnedAt : null, rarityPct: 40 })),
    );
    const played = vi.spyOn(psn, "getPlayedGames").mockResolvedValue([]);
    try {
      await prisma.linkedAccount.deleteMany({ where: { platform: "psn", externalId: ACCOUNT, user: { handle: { startsWith: "test_" } } } });
      const user = await prisma.user.create({
        data: {
          handle: `${HANDLE}_1`,
          displayName: "Teste",
          linkedAccounts: { create: { platform: "psn", externalId: ACCOUNT, handle: "Tralked-Teste", verifiedAt: new Date() } },
        },
      });
      expect((await syncPlatformAccount(user.id, "psn")).newUnlocks).toBe(1);

      const after = await prisma.achievement.findMany({ where: { gameId: game.id }, orderBy: { apiName: "asc" } });
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)); // same rows, none added
      expect(after.every((r) => r.globalPct === 40)).toBe(true); // the player's read adds the rarity
      expect(await prisma.trophyList.count({ where: { gameId: game.id } })).toBe(1);
      expect(await prisma.userTrophyList.count({ where: { userId: user.id, list: { gameId: game.id } } })).toBe(1);
    } finally {
      titles.mockRestore();
      trophies.mockRestore();
      played.mockRestore();
    }
  });

  it("reads one list per call", async () => {
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed([LIST, OTHER]);
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("loaded");
    expect(api.calls).toEqual([LIST]);
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("loaded");
    expect(api.calls).toEqual([LIST, OTHER]);
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("none");
  });

  it("a Sony failure gives the claim back and writes nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const boom = fakeApi(async () => {
        throw new Error("HTTP 429");
      });
      expect(await loadPsnCatalogTrophies(game.id, boom)).toBe("failed");
      expect(await loadPsnCatalogTrophies(game.id, fakeApi(async () => null), new Date(Date.now() + 2 * HOUR))).toBe("failed");
    } finally {
      warn.mockRestore();
    }
    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(0);
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesSyncedAt).toBeNull();
    // Try later: after the backoff (2 failures: 6 h) the next open reads it.
    expect(await loadPsnCatalogTrophies(game.id, fakeApi(), new Date(Date.now() + 8 * HOUR))).toBe("loaded");
  });

  it("refuses an answer that is not the list's", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Wrong counts (two bronze) and another list's icons.
      const counts = fakeApi(async () => [trophy(0, "platinum"), trophy(1, "bronze"), trophy(2, "bronze")]);
      expect(await loadPsnCatalogTrophies(game.id, counts)).toBe("failed");
      const later = new Date(Date.now() + 2 * HOUR);
      const foreign = DEFINITIONS.map((t) => ({ ...t, iconUrl: "https://image.api.playstation.com/trophy/np/NPWR14350_00BB.PNG" }));
      expect(await loadPsnCatalogTrophies(game.id, fakeApi(async () => foreign), later)).toBe("failed");
    } finally {
      warn.mockRestore();
    }
    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(0);
  });

  it("leaves a list a player already filled alone", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const list = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "psn", externalId: LIST } } });
    await prisma.achievement.create({ data: { gameId: game.id, platform: "psn", listId: list.id, apiName: "0", name: "x", trophyTier: "platinum" } });
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api)).toBe("none");
    expect(api.calls).toEqual([]);
  });

  it("a failing first list does not block the second, and a failing list backs off 1 h, 6 h, 24 h, then 7 d", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed([LIST, OTHER]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    const at = (hours: number, extraMs = 0) => new Date(t0 + hours * HOUR + extraMs);
    // LIST gives a wrong answer (not Sony being down: no cooldown); OTHER is fine.
    const api = {
      calls: [] as string[],
      async getListTrophies(id: string) {
        this.calls.push(id);
        if (id === LIST) throw new Error("boom");
        return DEFINITIONS.map((t) => ({ ...t, iconUrl: t.iconUrl?.replace(LIST, id) ?? null }));
      },
    };
    try {
      expect(await loadPsnCatalogTrophies(game.id, api, at(0))).toBe("failed");
      // The next open goes to OTHER, never tried, not to LIST again.
      expect(await loadPsnCatalogTrophies(game.id, api, at(0, 1000))).toBe("loaded");
      expect(api.calls).toEqual([LIST, OTHER]);
      // LIST is due again only after 1 h, then 6 h, 24 h and 7 d after each new failure.
      let when = 0;
      for (const wait of [1, 6, 24, 24 * 7]) {
        const calls = api.calls.length;
        expect(await loadPsnCatalogTrophies(game.id, api, at(when + wait - 0.01))).toBe("none");
        expect(api.calls).toHaveLength(calls);
        when += wait;
        expect(await loadPsnCatalogTrophies(game.id, api, at(when))).toBe("failed");
        expect(api.calls).toHaveLength(calls + 1);
      }
      expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesAttempts).toBe(5);
      // From the 4th failure on the wait stays 7 d.
      expect(await loadPsnCatalogTrophies(game.id, api, at(when + 24 * 7 - 0.01))).toBe("none");
    } finally {
      warn.mockRestore();
    }
  });

  it("a claim with no rows older than 10 minutes counts as due again", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const now = new Date();
    await prisma.psnCatalogList.update({ where: { id: LIST }, data: { trophiesSyncedAt: new Date(now.getTime() - 5 * 60_000) } });
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api, now)).toBe("none"); // someone is reading it
    expect(api.calls).toEqual([]);
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(now.getTime() + 6 * 60_000))).toBe("loaded");
    expect(api.calls).toEqual([LIST]);
  });

  it("a refusal of Sony stops every open for an hour", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed([LIST, OTHER]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    try {
      const down = fakeApi(async () => {
        throw new PsnHttpError("list trophies", 429, null);
      });
      expect(await loadPsnCatalogTrophies(game.id, down, new Date(t0))).toBe("failed");
      // The other list is due, but nothing calls Sony while cooling down.
      const api = fakeApi();
      expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 30 * 60_000))).toBe("none");
      expect(api.calls).toEqual([]);
      expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 61 * 60_000))).toBe("loaded");
      expect(api.calls).toEqual([OTHER]);
    } finally {
      warn.mockRestore();
    }
    expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_OPEN_COOLDOWN_KEY } })).value).toMatchObject({ until: expect.any(Number) });
  });

  it("the site-wide budget allows 6 reads a minute and 100 a day", async () => {
    const { prisma } = await import("@/lib/db");
    const { PSN_OPEN_PER_DAY, takePsnOpenBudget } = await import("./psn-catalog-trophies");
    expect(PSN_OPEN_PER_DAY).toBe(100);
    const t0 = new Date("2026-11-06T10:00:00Z").getTime();
    const taken: boolean[] = [];
    for (let i = 0; i < 8; i++) taken.push(await takePsnOpenBudget(new Date(t0 + i * 1000)));
    expect(taken).toEqual([true, true, true, true, true, true, false, false]);
    // A minute later the window opens again (7 reads today).
    expect(await takePsnOpenBudget(new Date(t0 + 61_000))).toBe(true);
    let n = 7;
    for (let minute = 3; n < 100; minute++) {
      for (let i = 0; i < 6 && n < 100; i++, n++) expect(await takePsnOpenBudget(new Date(t0 + minute * 60_000 + i))).toBe(true);
    }
    expect(await takePsnOpenBudget(new Date(t0 + 600 * 60_000))).toBe(false);
    expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_OPEN_BUDGET_KEY } })).value).toMatchObject({ dayCount: 100 });
    // The next day starts a new count.
    expect(await takePsnOpenBudget(new Date(t0 + 25 * HOUR))).toBe(true);
  });

  it("an open over the budget calls Sony no more and takes no claim", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies, takePsnOpenBudget } = await import("./psn-catalog-trophies");
    const game = await seed();
    const now = new Date();
    for (let i = 0; i < 6; i++) await takePsnOpenBudget(now);
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api, now)).toBe("none");
    expect(api.calls).toEqual([]);
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesSyncedAt).toBeNull();
  });

  it("a 429 or 503 from the real client stops every open for an hour", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPsnClient } = await import("@/lib/integrations/psn/client");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed([LIST, OTHER]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    let status = 429;
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/oauth/authorize")) {
        return new Response(null, { status: 302, headers: { location: "com.scee.psxandroid.scecompcall://redirect/?code=v3.CODE&cid=x" } });
      }
      if (url.pathname.endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "T", expires_in: 3600, refresh_token: "R", refresh_token_expires_in: 5_184_000 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status });
    });
    const client = createPsnClient({ npsso: "npsso-secret-value-0123456789", fetch: fetchStub as unknown as typeof fetch });
    try {
      for (const code of [429, 503]) {
        await prisma.syncCursor.deleteMany({ where: { key: PSN_OPEN_COOLDOWN_KEY } });
        await prisma.psnCatalogList.updateMany({ data: { trophiesSyncedAt: null, trophiesTriedAt: null, trophiesAttempts: 0 } });
        status = code;
        expect(await loadPsnCatalogTrophies(game.id, client, new Date(t0))).toBe("failed");
        const sonyCalls = fetchStub.mock.calls.length;
        // The cooldown is on: the other list is not asked.
        expect(await loadPsnCatalogTrophies(game.id, client, new Date(t0 + 30 * 60_000))).toBe("none");
        expect(fetchStub.mock.calls).toHaveLength(sonyCalls);
        expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_OPEN_COOLDOWN_KEY } })).value).toMatchObject({ until: t0 + 3_600_000 });
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("a read that keeps crashing its instance waits longer each time", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const t0 = Date.now();
    // Simulate the dead reader: a claim made 11 minutes ago, never given back.
    const stale = async (at: number) =>
      prisma.psnCatalogList.update({ where: { id: LIST }, data: { trophiesSyncedAt: new Date(at) } });
    await stale(t0 - 11 * 60_000);
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0))).toBe("loaded"); // first takeover: due after 10 min

    // Second list state: crashed again. Takeover #1 counted (attempts 1): the next one waits 1 h, not 10 min.
    await prisma.achievement.deleteMany({ where: { gameId: game.id } });
    await prisma.psnCatalogList.update({ where: { id: LIST }, data: { trophiesAttempts: 1, trophiesTriedAt: null, trophiesSyncedAt: new Date(t0) } });
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 11 * 60_000))).toBe("none");
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 61 * 60_000))).toBe("loaded");
    expect(api.calls).toHaveLength(2);
  });

  it("a takeover of a stale claim adds an attempt", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies } = await import("./psn-catalog-trophies");
    const game = await seed();
    const t0 = Date.now();
    await prisma.psnCatalogList.update({ where: { id: LIST }, data: { trophiesSyncedAt: new Date(t0 - 11 * 60_000) } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bad = fakeApi(async () => {
        throw new Error("boom");
      });
      expect(await loadPsnCatalogTrophies(game.id, bad, new Date(t0))).toBe("failed");
    } finally {
      warn.mockRestore();
    }
    // One for the crash it took over, one for this failure.
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesAttempts).toBe(2);
  });

  it("the budget unit comes back when no Sony call follows", async () => {
    const { prisma } = await import("@/lib/db");
    const { takePsnOpenBudget, refundPsnOpenBudget } = await import("./psn-catalog-trophies");
    const now = new Date();
    for (let i = 0; i < 3; i++) await takePsnOpenBudget(now);
    await refundPsnOpenBudget(now);
    expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_OPEN_BUDGET_KEY } })).value).toMatchObject({ count: 2, dayCount: 2 });
    for (let i = 0; i < 4; i++) expect(await takePsnOpenBudget(now)).toBe(true); // 6 in the minute again
    expect(await takePsnOpenBudget(now)).toBe(false);
  });

  it("a database over 900 MB reads nothing more, by a size read at most once an hour", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies, PSN_DB_SIZE_CHECK_MS, PSN_DB_SIZE_LIMIT_BYTES, resetPsnDbSizeCache } = await import("./psn-catalog-trophies");
    expect(PSN_DB_SIZE_LIMIT_BYTES).toBe(900 * 1024 * 1024);
    expect(PSN_DB_SIZE_CHECK_MS).toBe(HOUR);
    resetPsnDbSizeCache();
    const game = await seed([LIST, OTHER]);
    const t0 = Date.now();
    let bytes = PSN_DB_SIZE_LIMIT_BYTES + 1;
    let reads = 0;
    const databaseBytes = async () => (reads++, bytes);
    const api = fakeApi();

    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0), { databaseBytes })).toBe("none");
    expect(api.calls).toEqual([]);
    // No budget taken and no claim.
    expect(await prisma.syncCursor.findUnique({ where: { key: PSN_OPEN_BUDGET_KEY } })).toBeNull();
    expect((await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: LIST } })).trophiesSyncedAt).toBeNull();

    // The database shrinks, but the instance keeps the size it read for an hour.
    bytes = 1024;
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 30 * 60_000), { databaseBytes })).toBe("none");
    expect(reads).toBe(1);
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + HOUR), { databaseBytes })).toBe("loaded");
    expect(reads).toBe(2);
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + HOUR + 60_000), { databaseBytes })).toBe("loaded");
    expect(reads).toBe(2);
    expect(api.calls).toEqual([LIST, OTHER]);

    // A size that cannot be read counts as too big and is read again on the next open.
    resetPsnDbSizeCache();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await prisma.achievement.deleteMany({ where: { gameId: game.id } });
      await prisma.psnCatalogList.updateMany({ where: { id: { in: [LIST, OTHER] } }, data: { trophiesSyncedAt: null } });
      const broken = async (): Promise<number> => {
        reads++;
        throw new Error("no size");
      };
      expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 2 * HOUR), { databaseBytes: broken })).toBe("none");
      expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 2 * HOUR + 1), { databaseBytes: broken })).toBe("none");
      expect(reads).toBe(4);
    } finally {
      warn.mockRestore();
    }
    // The real size of the test database is far under the limit.
    resetPsnDbSizeCache();
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 3 * HOUR))).toBe("loaded");
  });

  it("a page open waits for the scan's 4 h pause too; its own 1 h pause never skips a scan slot", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadPsnCatalogTrophies, psnCooldownUntil, startPsnCooldown } = await import("./psn-catalog-trophies");
    const game = await seed([LIST, OTHER]);
    const t0 = Date.now();
    const scanPause = (at: number) => psnCooldownUntil(new Date(at), prisma, [PSN_SCAN_COOLDOWN_KEY]);
    expect(await psnCooldownUntil(new Date(t0))).toBeNull();

    // The scan's pause (written by a throttled slice) holds every page open back.
    await startPsnCooldown(t0 + 4 * HOUR, prisma, PSN_SCAN_COOLDOWN_KEY);
    expect(await psnCooldownUntil(new Date(t0))).toBe(t0 + 4 * HOUR);
    const api = fakeApi();
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 3 * HOUR))).toBe("none");
    expect(api.calls).toEqual([]);
    await prisma.syncCursor.deleteMany({ where: { key: PSN_SCAN_COOLDOWN_KEY } });

    // A page open refused with 403: its 1 h pause, on its own key only; the worker's check stays clear.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const refused = fakeApi(async () => {
        throw new PsnHttpError("list trophies", 403, null);
      });
      expect(await loadPsnCatalogTrophies(game.id, refused, new Date(t0))).toBe("failed");
    } finally {
      warn.mockRestore();
    }
    expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_OPEN_COOLDOWN_KEY } })).value).toEqual({ until: t0 + HOUR });
    expect(await prisma.syncCursor.findUnique({ where: { key: PSN_SCAN_COOLDOWN_KEY } })).toBeNull();
    expect(await scanPause(t0)).toBeNull();
    expect(await psnCooldownUntil(new Date(t0))).toBe(t0 + HOUR);
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 30 * 60_000))).toBe("none");

    // Both held: the later one is the answer. A shorter pause of a key never shortens it.
    await startPsnCooldown(t0 + 2 * HOUR, prisma, PSN_SCAN_COOLDOWN_KEY);
    expect(await psnCooldownUntil(new Date(t0))).toBe(t0 + 2 * HOUR);
    await startPsnCooldown(t0 + HOUR / 2, prisma, PSN_SCAN_COOLDOWN_KEY);
    expect(await scanPause(t0)).toBe(t0 + 2 * HOUR);
    await startPsnCooldown(t0 + HOUR / 2);
    expect(await psnCooldownUntil(new Date(t0), prisma, [PSN_OPEN_COOLDOWN_KEY])).toBe(t0 + HOUR);
    expect(await loadPsnCatalogTrophies(game.id, api, new Date(t0 + 2 * HOUR))).toBe("loaded");
  });
});
