import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnListInfo, PsnServiceName } from "@/lib/integrations/psn/types";
import { PSN_MIN_GAP_MS, PSN_MISS_LIMIT, PSN_SCAN_CURSOR, scanPsnIds } from "./psn-catalog";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable. No Sony call is made:
// the catalog API is a stub.
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
const BASE = 99_000; // NPWR99000_00 and up: far past the real ceiling (~60.5k)
const TAG = "Zzpsncat";
const idOf = (n: number) => `NPWR${String(n).padStart(5, "0")}_00`;

type Fake = Record<string, { service: PsnServiceName; name: string; platform: string; counts?: [number, number, number, number] } | undefined>;

/** A stub of the Sony catalog call: answers for the listed ids on their own service, 404 elsewhere. */
function fakeApi(lists: Fake, calls: { id: string; service: PsnServiceName }[] = []) {
  return {
    calls,
    async getListInfo(npTitleId: string, serviceName: PsnServiceName): Promise<PsnListInfo | null> {
      calls.push({ id: npTitleId, service: serviceName });
      const l = lists[npTitleId];
      if (!l || l.service !== serviceName) return null;
      const [bronze, silver, gold, platinum] = l.counts ?? [10, 5, 2, 1];
      return { npTitleId, serviceName, name: l.name, platform: l.platform, trophyCounts: { bronze, silver, gold, platinum } };
    },
  };
}

/** A clock that only moves when the scan sleeps. */
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe.skipIf(!reachable)("PSN catalog scan", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.psnCatalogList.deleteMany({ where: { id: { gte: idOf(BASE), lte: idOf(BASE + 99) } } });
    await prisma.syncCursor.deleteMany({ where: { key: PSN_SCAN_CURSOR } });
  }
  beforeAll(cleanup);
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("scan stores name console and counts", async () => {
    const { prisma } = await import("@/lib/db");
    const clock = fakeClock();
    const api = fakeApi({
      [idOf(BASE)]: { service: "trophy", name: `${TAG} Vita Game`, platform: "PSVITA,PS3", counts: [20, 4, 1, 1] },
      [idOf(BASE + 2)]: { service: "trophy2", name: `${TAG} Five`, platform: "PS5" },
    });
    const result = await scanPsnIds({ api, from: BASE, count: 3, deadline: Infinity, ...clock });
    expect(result).toMatchObject({ scanned: 3, hits: 2, stopped: "count", next: BASE + 3 });

    const vita = await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: idOf(BASE) } });
    expect(vita).toMatchObject({ name: `${TAG} Vita Game`, console: "PS3+PSVITA", serviceName: "trophy", trophyCount: 26 });
    expect(vita.tiers).toEqual({ bronze: 20, silver: 4, gold: 1, platinum: 1 });
    expect(vita.matchedAt).toBeNull();
    const five = await prisma.psnCatalogList.findUniqueOrThrow({ where: { id: idOf(BASE + 2) } });
    expect(five).toMatchObject({ console: "PS5", serviceName: "trophy2", trophyCount: 18 });
    // The gap between ids is not a row.
    expect(await prisma.psnCatalogList.findUnique({ where: { id: idOf(BASE + 1) } })).toBeNull();
  });

  it("scan resumes from the cursor", async () => {
    const { prisma } = await import("@/lib/db");
    const lists: Fake = {};
    for (let i = 0; i < 6; i++) lists[idOf(BASE + i)] = { service: "trophy2", name: `${TAG} ${i}`, platform: "PS5" };
    const calls: { id: string; service: PsnServiceName }[] = [];
    const api = fakeApi(lists, calls);
    const clock = fakeClock();

    await scanPsnIds({ api, from: BASE, count: 4, deadline: Infinity, ...clock });
    expect(await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } })).toMatchObject({ value: { next: BASE + 4 } });

    calls.length = 0;
    // No `from`: it picks up where the last slice ended.
    const second = await scanPsnIds({ api, count: 2, deadline: Infinity, ...clock });
    expect(calls.map((c) => c.id)).toEqual([idOf(BASE + 4), idOf(BASE + 5)]);
    expect(second.next).toBe(BASE + 6);
    expect(await prisma.psnCatalogList.count({ where: { id: { gte: idOf(BASE), lte: idOf(BASE + 9) } } })).toBe(6);
  });

  it("404 on both services is skipped", async () => {
    const { prisma } = await import("@/lib/db");
    const calls: { id: string; service: PsnServiceName }[] = [];
    const api = fakeApi({ [idOf(BASE + 1)]: { service: "trophy", name: `${TAG} After the gap`, platform: "PS4" } }, calls);
    const result = await scanPsnIds({ api, from: BASE, count: 2, deadline: Infinity, ...fakeClock() });
    expect(result).toMatchObject({ scanned: 2, hits: 1, stopped: "count" });
    // The empty id was asked on both services.
    expect(calls.filter((c) => c.id === idOf(BASE)).map((c) => c.service).sort()).toEqual(["trophy", "trophy2"]);
    expect(await prisma.psnCatalogList.count({ where: { id: idOf(BASE) } })).toBe(0);
    expect(await prisma.psnCatalogList.count({ where: { id: idOf(BASE + 1) } })).toBe(1);
  });

  it("asks Sony once every 2 s, never faster", async () => {
    const stamps: number[] = [];
    const clock = fakeClock();
    const api = fakeApi({});
    const timed = {
      getListInfo: async (...a: Parameters<typeof api.getListInfo>) => (stamps.push(clock.now()), api.getListInfo(...a)),
    };
    await scanPsnIds({ api: timed, from: BASE, count: 3, deadline: Infinity, ...clock });
    expect(PSN_MIN_GAP_MS).toBe(2000);
    expect(stamps).toHaveLength(6);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(2000);
  });

  it("backs off on 429 and ends the slice keeping the cursor on the failed id", async () => {
    const { prisma } = await import("@/lib/db");
    const clock = fakeClock();
    let tries = 0;
    const api = {
      async getListInfo(id: string, service: PsnServiceName): Promise<PsnListInfo | null> {
        if (id === idOf(BASE + 1)) {
          tries++;
          throw new PsnHttpError("trophy groups", 429, null);
        }
        return service === "trophy2"
          ? { npTitleId: id, serviceName: service, name: `${TAG} ok`, platform: "PS5", trophyCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 } }
          : null;
      },
    };
    const before = clock.now();
    const result = await scanPsnIds({ api, from: BASE, count: 5, deadline: Infinity, ...clock });
    expect(result).toMatchObject({ stopped: "throttled", scanned: 1, hits: 1, next: BASE + 1 });
    expect(tries).toBeGreaterThan(1);
    expect(clock.now() - before).toBeGreaterThanOrEqual(2000 * tries); // it waited between tries
    // The row before the failure was kept; the cursor points at the id to ask again.
    expect(await prisma.psnCatalogList.count({ where: { id: idOf(BASE) } })).toBe(1);
    expect(await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } })).toMatchObject({ value: { next: BASE + 1 } });
  });

  it("stops after PSN_MISS_LIMIT consecutive misses and starts a new lap", async () => {
    const { prisma } = await import("@/lib/db");
    expect(PSN_MISS_LIMIT).toBe(2000);
    const api = fakeApi({ [idOf(BASE)]: { service: "trophy2", name: `${TAG} last`, platform: "PS5" } });
    const result = await scanPsnIds({ api, from: BASE, count: PSN_MISS_LIMIT + 50, deadline: Infinity, ...fakeClock() });
    // The hit resets the count: the limit is reached PSN_MISS_LIMIT ids past it.
    expect(result).toMatchObject({ stopped: "ceiling", hits: 1, scanned: 1 + PSN_MISS_LIMIT });
    const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } });
    expect(cursor.value).toMatchObject({ next: 1, misses: 0 });
    expect((cursor.value as { completedAt: string | null }).completedAt).toEqual(expect.any(String));
  });

  it("stops at the deadline", async () => {
    const clock = fakeClock();
    const result = await scanPsnIds({ api: fakeApi({}), from: BASE, count: 50, deadline: clock.now() + 5_000, ...clock });
    expect(result.stopped).toBe("deadline");
    expect(result.scanned).toBeLessThan(5);
  });
});

describe.skipIf(!reachable)("PSN catalog match", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.psnCatalogList.deleteMany({ where: { name: { contains: TAG } } });
    await prisma.game.deleteMany({ where: { name: { contains: TAG } } });
  }
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("match links only unique PlayStation names", async () => {
    const { prisma } = await import("@/lib/db");
    const { matchPsnCatalog } = await import("./psn-catalog");
    const mk = (slug: string, name: string, platforms: string[]) =>
      prisma.game.create({ data: { slug, name, platforms, achievementCount: 0 } });
    const ps = await mk("zzpsncat-unique", `${TAG} Unique`, ["PLAYSTATION"]);
    await mk("zzpsncat-twin-a", `${TAG} Twin`, ["PLAYSTATION"]);
    await mk("zzpsncat-twin-b", `${TAG} Twin`, ["PLAYSTATION"]);
    const pc = await mk("zzpsncat-pconly", `${TAG} PC Only`, ["PC"]);
    const mixed = await mk("zzpsncat-mixed", `${TAG} Mixed`, ["PC", "PLAYSTATION"]);
    const entry = (n: number, name: string, console = "PS5") => ({
      id: idOf(BASE + 100 + n),
      name,
      console,
      serviceName: console === "PS5" ? "trophy2" : "trophy",
      trophyCount: 30,
      tiers: { bronze: 20, silver: 6, gold: 3, platinum: 1 },
    });
    await prisma.psnCatalogList.createMany({
      data: [
        entry(0, `${TAG} Unique`),
        entry(1, `${TAG} Unique`, "PS3+PSVITA"), // a second list of the same game: the same game
        entry(2, `${TAG} Twin`),
        entry(3, `${TAG} PC Only`),
        entry(4, `${TAG} Mixed`),
        entry(5, `${TAG} Nobody has this`),
        entry(6, `${TAG} Already Played`),
      ],
    });
    // A list a player already has progress on is never touched.
    const played = await mk("zzpsncat-played", `${TAG} Already Played`, ["PLAYSTATION"]);
    const mine = await prisma.trophyList.create({
      data: { gameId: played.id, platform: "psn", externalId: idOf(BASE + 106), console: "PS4", name: "Old name", trophyCount: 9 },
    });

    const at = new Date("2026-11-11T12:00:00Z");
    const result = await matchPsnCatalog({ now: () => at });
    expect(result).toEqual({ linked: 3, ambiguous: 1, unmatched: 2, existing: 1 });

    const list = (n: number) =>
      prisma.trophyList.findUnique({ where: { platform_externalId: { platform: "psn", externalId: idOf(BASE + 100 + n) } } });
    expect(await list(0)).toMatchObject({ gameId: ps.id, console: "PS5", trophyCount: 30, serviceName: "trophy2" });
    expect(await list(1)).toMatchObject({ gameId: ps.id, console: "PS3+PSVITA" });
    expect(await list(4)).toMatchObject({ gameId: mixed.id });
    for (const n of [2, 3, 5]) expect(await list(n)).toBeNull(); // twin, PC-only, unknown
    expect(await prisma.achievement.count({ where: { listId: (await list(0))!.id } })).toBe(0); // no trophies written
    const link = await prisma.gamePlatformLink.findUnique({
      where: { platform_externalId: { platform: "psn", externalId: idOf(BASE + 100) } },
    });
    expect(link?.gameId).toBe(ps.id);
    expect(await prisma.gamePlatformLink.count({ where: { gameId: pc.id } })).toBe(0);
    expect(await prisma.trophyList.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({
      name: "Old name",
      console: "PS4",
      trophyCount: 9,
    });

    // Every row was looked at; the unmatched ones wait 30 days.
    expect(await prisma.psnCatalogList.count({ where: { name: { contains: TAG }, matchedAt: null } })).toBe(0);
    await expect(matchPsnCatalog({ now: () => at })).resolves.toEqual({ linked: 0, ambiguous: 0, unmatched: 0, existing: 0 });
  });
});
