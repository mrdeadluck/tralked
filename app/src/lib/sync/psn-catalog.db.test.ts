import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { PsnHttpError } from "@/lib/integrations/psn/client";
import type { PsnListInfo, PsnServiceName } from "@/lib/integrations/psn/types";
import { PsnAuthError } from "@/lib/integrations/psn/client";
import {
  knownPsnCeiling,
  PSN_MIN_GAP_MS,
  PSN_MISS_LIMIT,
  PSN_SCAN_COOLDOWN_MS,
  PSN_SCAN_CURSOR,
  PSN_STUCK_RUNS,
  psnSliceMinutes,
  scanPsnIds,
} from "./psn-catalog";
import { PSN_OPEN_COOLDOWN_KEY, psnCooldownUntil } from "./psn-catalog-trophies";

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
    await prisma.syncCursor.deleteMany({ where: { key: { in: [PSN_SCAN_CURSOR, PSN_OPEN_COOLDOWN_KEY] } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: "zzpsncat-ceiling" } } });
  }
  /** The Sony pause the scan left, as the worker and the page opens read it. */
  const pause = async () => {
    const { prisma } = await import("@/lib/db");
    return prisma.syncCursor.findUnique({ where: { key: PSN_OPEN_COOLDOWN_KEY } });
  };
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

  it("asks Sony once every 3 s (psnawp's 300 per 15 min), never faster", async () => {
    const stamps: number[] = [];
    const clock = fakeClock();
    const api = fakeApi({});
    const timed = {
      getListInfo: async (...a: Parameters<typeof api.getListInfo>) => (stamps.push(clock.now()), api.getListInfo(...a)),
    };
    await scanPsnIds({ api: timed, from: BASE, count: 3, deadline: Infinity, ...clock });
    expect(PSN_MIN_GAP_MS).toBe(3000);
    expect(stamps).toHaveLength(6);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(3000);
    // A clean slice pauses nothing.
    expect(await pause()).toBeNull();
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
    const wall = Date.now();
    const result = await scanPsnIds({ api, from: BASE, count: 5, deadline: Infinity, ...clock });
    expect(result).toMatchObject({ stopped: "throttled", scanned: 1, hits: 1, next: BASE + 1 });
    expect(tries).toBeGreaterThan(1);
    expect(clock.now() - before).toBeGreaterThanOrEqual(3000 * tries); // it waited between tries
    // Every Sony call of the site pauses for 4 h: the worker's next slots and the page opens.
    expect(PSN_SCAN_COOLDOWN_MS).toBe(4 * 3_600_000);
    expect(result.cooldownUntil).toBeGreaterThanOrEqual(wall + PSN_SCAN_COOLDOWN_MS);
    expect(result.cooldownUntil).toBeLessThan(Date.now() + PSN_SCAN_COOLDOWN_MS + 1);
    expect((await pause())?.value).toEqual({ until: result.cooldownUntil });
    expect(await psnCooldownUntil(new Date())).toBe(result.cooldownUntil);
    expect(await psnCooldownUntil(new Date(result.cooldownUntil! + 1))).toBeNull();
    // The row before the failure was kept; the cursor points at the id to ask again.
    expect(await prisma.psnCatalogList.count({ where: { id: idOf(BASE) } })).toBe(1);
    expect(await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } })).toMatchObject({ value: { next: BASE + 1 } });
  });

  it("a 5xx after the retries pauses Sony for 4 h too; a dropped connection or a 400 does not", async () => {
    const failing = (error: () => Error) => ({
      getListInfo: async (): Promise<PsnListInfo | null> => {
        throw error();
      },
    });
    const down = await scanPsnIds({ api: failing(() => new PsnHttpError("trophy groups", 503, null)), from: BASE, count: 5, deadline: Infinity, ...fakeClock() });
    expect(down).toMatchObject({ stopped: "throttled", cooldownUntil: expect.any(Number) });
    expect(await pause()).not.toBeNull();

    const { prisma } = await import("@/lib/db");
    await prisma.syncCursor.deleteMany({ where: { key: PSN_OPEN_COOLDOWN_KEY } });
    const network = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    const offline = await scanPsnIds({ api: failing(network), from: BASE, count: 5, deadline: Infinity, ...fakeClock() });
    expect(offline).toMatchObject({ stopped: "throttled", cooldownUntil: null });
    const bad = await scanPsnIds({ api: failing(() => new PsnHttpError("trophy groups", 400, null)), from: BASE, count: 5, deadline: Infinity, ...fakeClock() });
    expect(bad).toMatchObject({ stopped: "forbidden", cooldownUntil: null });
    expect(await pause()).toBeNull();
  });

  it("a lap never ends below the highest NPWR id a TrophyList holds", async () => {
    const { prisma } = await import("@/lib/db");
    // Given: the misses run out 2,000 ids past the last hit, but a player's list is further up.
    const result = await scanPsnIds({ api: fakeApi({}), from: BASE, count: 3 * PSN_MISS_LIMIT, deadline: Infinity, knownCeiling: BASE + 2500, ...fakeClock() });
    expect(result).toMatchObject({ stopped: "ceiling", scanned: 2501 });

    // Read from the database when not given.
    const game = await prisma.game.create({ data: { slug: "zzpsncat-ceiling", name: `${TAG} Ceiling`, platforms: ["PLAYSTATION"], achievementCount: 0 } });
    await prisma.trophyList.create({ data: { gameId: game.id, platform: "psn", externalId: "NPWR99950_00", console: "PS5", name: "x" } });
    await prisma.trophyList.create({ data: { gameId: game.id, platform: "psn", externalId: "zzpsncat-NPWR99999_00", console: "PS5", name: "y" } });
    expect(await knownPsnCeiling()).toBe(99950);
    const fromDb = await scanPsnIds({ api: fakeApi({}), from: 97_000, count: 3 * PSN_MISS_LIMIT, deadline: Infinity, ...fakeClock() });
    expect(fromDb).toMatchObject({ stopped: "ceiling", scanned: 99950 - 97_000 + 1 });
  });

  it("stops after PSN_MISS_LIMIT consecutive misses and starts a new lap", async () => {
    const { prisma } = await import("@/lib/db");
    expect(PSN_MISS_LIMIT).toBe(2000);
    const api = fakeApi({ [idOf(BASE)]: { service: "trophy2", name: `${TAG} last`, platform: "PS5" } });
    const result = await scanPsnIds({ api, from: BASE, count: PSN_MISS_LIMIT + 50, deadline: Infinity, knownCeiling: 0, ...fakeClock() });
    // The hit resets the count: the limit is reached PSN_MISS_LIMIT ids past it.
    expect(result).toMatchObject({ stopped: "ceiling", hits: 1, scanned: 1 + PSN_MISS_LIMIT });
    const cursor = await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } });
    expect(cursor.value).toMatchObject({ next: 1, misses: 0 });
    expect((cursor.value as { completedAt: string | null }).completedAt).toEqual(expect.any(String));
  });

  it("writes nothing while it walks: one write, at the end of the slice", async () => {
    const { prisma } = await import("@/lib/db");
    const lists: Fake = {};
    for (let i = 0; i < 70; i++) lists[idOf(BASE + i)] = { service: "trophy2", name: `${TAG} ${i}`, platform: "PS5" };
    const inner = fakeApi(lists);
    let seenDuring = -1;
    let cursorDuring: unknown = "unset";
    let calls = 0;
    const api = {
      async getListInfo(id: string, service: PsnServiceName) {
        if (++calls === 65) {
          seenDuring = await prisma.psnCatalogList.count({ where: { id: { gte: idOf(BASE), lte: idOf(BASE + 99) } } });
          cursorDuring = await prisma.syncCursor.findUnique({ where: { key: PSN_SCAN_CURSOR } });
        }
        return inner.getListInfo(id, service);
      },
    };
    const result = await scanPsnIds({ api, from: BASE, count: 70, deadline: Infinity, ...fakeClock() });
    expect(seenDuring).toBe(0);
    expect(cursorDuring).toBeNull();
    expect(result.hits).toBe(70);
    expect(await prisma.psnCatalogList.count({ where: { id: { gte: idOf(BASE), lte: idOf(BASE + 99) } } })).toBe(70);
  });

  it("keeps what it read when a stop signal ends the slice", async () => {
    const { prisma } = await import("@/lib/db");
    const lists: Fake = {};
    for (let i = 0; i < 10; i++) lists[idOf(BASE + i)] = { service: "trophy2", name: `${TAG} ${i}`, platform: "PS5" };
    let asked = 0;
    const api = fakeApi(lists);
    const counted = { getListInfo: async (...a: Parameters<typeof api.getListInfo>) => (asked++, api.getListInfo(...a)) };
    const result = await scanPsnIds({ api: counted, from: BASE, count: 10, deadline: Infinity, shouldStop: () => asked >= 3, ...fakeClock() });
    expect(result).toMatchObject({ stopped: "signal", scanned: 3, next: BASE + 3 });
    expect(await prisma.psnCatalogList.count({ where: { id: { gte: idOf(BASE), lte: idOf(BASE + 99) } } })).toBe(3);
  });

  describe("an id Sony refuses", () => {
    const refusing = (bad: string, status: number, calls: string[] = []) => ({
      async getListInfo(id: string, service: PsnServiceName): Promise<PsnListInfo | null> {
        calls.push(id);
        if (id === bad) throw new PsnHttpError("trophy groups", status, null);
        return service === "trophy2"
          ? { npTitleId: id, serviceName: service, name: `${TAG} ok`, platform: "PS5", trophyCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 } }
          : null;
      },
    });
    const cursor = async () => {
      const { prisma } = await import("@/lib/db");
      return (await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } })).value as Record<string, unknown>;
    };

    it("is skipped by the slice after PSN_STUCK_RUNS refused slices in a row", async () => {
      expect(PSN_STUCK_RUNS).toBe(3);
      const bad = idOf(BASE + 1);
      const api = refusing(bad, 403);
      for (let run = 1; run <= PSN_STUCK_RUNS; run++) {
        const r = await scanPsnIds({ api, ...(run === 1 ? { from: BASE } : {}), count: 5, deadline: Infinity, ...fakeClock() });
        expect(r).toMatchObject({ stopped: "forbidden", next: BASE + 1 });
        expect((await cursor()).stuck).toEqual({ id: bad, runs: run });
        // The scan stops at its first 403: that refusal pauses every Sony call for 4 h.
        expect(r.cooldownUntil).toEqual(expect.any(Number));
        expect(await pause()).not.toBeNull();
      }
      const fourth = await scanPsnIds({ api, count: 5, deadline: Infinity, ...fakeClock() });
      expect(fourth).toMatchObject({ stopped: "count", scanned: 5, next: BASE + 6 });
      const after = await cursor();
      expect(after.stuck).toBeUndefined();
      expect(after.skipped).toEqual([bad]);
    });

    it("a different refused id starts the count again", async () => {
      await scanPsnIds({ api: refusing(idOf(BASE + 1), 400), from: BASE, count: 5, deadline: Infinity, ...fakeClock() });
      expect((await cursor()).stuck).toEqual({ id: idOf(BASE + 1), runs: 1 });
      await scanPsnIds({ api: refusing(idOf(BASE + 1), 400), count: 5, deadline: Infinity, ...fakeClock() });
      expect((await cursor()).stuck).toEqual({ id: idOf(BASE + 1), runs: 2 });
      await scanPsnIds({ api: refusing(idOf(BASE + 1), 400), from: BASE + 3, count: 5, deadline: Infinity, ...fakeClock() });
      // The id 1 is passed no more; a later refusal elsewhere counts from 1.
      await scanPsnIds({ api: refusing(idOf(BASE + 9), 403), from: BASE + 8, count: 5, deadline: Infinity, ...fakeClock() });
      expect((await cursor()).stuck).toEqual({ id: idOf(BASE + 9), runs: 1 });
    });

    it("a 401 is fatal and never skipped", async () => {
      const bad = idOf(BASE + 1);
      for (let run = 0; run < PSN_STUCK_RUNS + 1; run++) {
        await expect(scanPsnIds({ api: refusing(bad, 401), from: BASE + 1, count: 5, deadline: Infinity, ...fakeClock() })).rejects.toMatchObject({ status: 401 });
      }
      const state = await cursor();
      expect(state.next).toBe(BASE + 1);
      expect(state.stuck).toBeUndefined();
      expect(state.skipped).toBeUndefined();
      const auth = { getListInfo: async (): Promise<PsnListInfo | null> => { throw new PsnAuthError("authorize", 302); } };
      await expect(scanPsnIds({ api: auth, from: BASE, count: 1, deadline: Infinity, ...fakeClock() })).rejects.toBeInstanceOf(PsnAuthError);
    });
  });

  it("psnSliceMinutes ends 2 minutes before the next neighbour job, on time or late", () => {
    const at = (hhmm: string) => psnSliceMinutes(new Date(`2026-11-11T${hhmm}:00Z`));
    // The seven slots, on time: 50 min, over before the :23 of the next odd hour.
    for (const slot of ["00:20", "06:20", "10:20", "12:20", "16:20", "18:20", "22:20"]) expect(at(slot)).toBe(50);
    expect(at("10:50")).toBe(31); // late: ends 11:21
    expect(at("22:50")).toBe(31);
    expect(at("11:18")).toBe(0); // too late to scan: the :23 jobs start
    // Very late, inside platform-import's window (odd :28 for up to 0.8 h): no scan.
    expect(at("11:30")).toBe(0);
    expect(at("12:10")).toBe(0);
    // Before the dispatched steam-details (:28 of 2/8/14/20) and catalog-enrich (04:28).
    expect(at("02:17")).toBe(9);
    expect(at("08:20")).toBe(6);
    expect(at("04:24")).toBe(0);
    expect(at("04:40")).toBe(41); // next job 05:23
  });

  it("retries network errors only: a TypeError is not retried, a dropped connection is", async () => {
    const ok = (id: string): PsnListInfo => ({ npTitleId: id, serviceName: "trophy2", name: `${TAG} n`, platform: "PS5", trophyCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 } });
    let typeErrorCalls = 0;
    const typeError = {
      getListInfo: async (): Promise<PsnListInfo | null> => {
        typeErrorCalls++;
        throw new TypeError("x is not a function");
      },
    };
    await expect(scanPsnIds({ api: typeError, from: BASE, count: 1, deadline: Infinity, ...fakeClock() })).rejects.toBeInstanceOf(TypeError);
    expect(typeErrorCalls).toBe(1);

    let dropped = 0;
    const flaky = {
      getListInfo: async (id: string): Promise<PsnListInfo | null> => {
        if (dropped++ === 0) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
        return ok(id);
      },
    };
    const result = await scanPsnIds({ api: flaky, from: BASE, count: 1, deadline: Infinity, ...fakeClock() });
    expect(dropped).toBe(2);
    expect(result).toMatchObject({ hits: 1, stopped: "count" });
  });

  it("a new lap clears the end of the last one", async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.syncCursor.create({ data: { key: PSN_SCAN_CURSOR, value: { next: 1, misses: 0, service: "trophy2", completedAt: "2026-01-01T00:00:00.000Z" } } });
    await scanPsnIds({ api: fakeApi({}), from: 1, count: 1, deadline: Infinity, ...fakeClock() });
    expect((await prisma.syncCursor.findUniqueOrThrow({ where: { key: PSN_SCAN_CURSOR } })).value).toMatchObject({ next: 2, completedAt: null });
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

  it("the match check agrees with the games the players' lists belong to: correct, wrong and no-match", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkPsnMatcher, pickPsnMatch, psnListsForCheck } = await import("./psn-catalog");
    const mk = (slug: string, name: string, platforms: string[]) =>
      prisma.game.create({ data: { slug, name, platforms, achievementCount: 0 } });
    const right = await mk("zzpsncat-chk-right", `${TAG} Check Right`, ["PLAYSTATION"]);
    // The list sits on a PC game; the matcher would pick the PlayStation game of the same name.
    const pcCopy = await mk("zzpsncat-chk-pc", `${TAG} Check Wrong`, ["PC"]);
    const psCopy = await mk("zzpsncat-chk-ps", `${TAG} Check Wrong`, ["PLAYSTATION"]);
    const twinA = await mk("zzpsncat-chk-twin-a", `${TAG} Check Twin`, ["PLAYSTATION"]);
    await mk("zzpsncat-chk-twin-b", `${TAG} Check Twin`, ["PLAYSTATION"]);
    const lonely = await mk("zzpsncat-chk-lonely", `${TAG} Check Lonely`, ["PC"]);
    const list = (n: number, gameId: string, name: string) =>
      prisma.trophyList.create({ data: { gameId, platform: "psn", externalId: idOf(BASE + 200 + n), console: "PS5", name } });
    await list(0, right.id, `${TAG} Check Right`);
    await list(1, pcCopy.id, `${TAG} Check Wrong`);
    await list(2, twinA.id, `${TAG} Check Twin`);
    await list(3, lonely.id, `${TAG} Check Lonely (Sony name)`);

    // Only this test's lists (the database has others).
    const mine = (await psnListsForCheck()).filter((l) => l.name.startsWith(`${TAG} Check`));
    expect(mine.map((l) => l.externalId)).toEqual([0, 1, 2, 3].map((n) => idOf(BASE + 200 + n)));
    const result = await checkPsnMatcher(mine, prisma, 2); // chunks of 2: the chunking is covered too
    expect(result).toEqual({
      checked: 4,
      correct: 1,
      wrong: [{ externalId: idOf(BASE + 201), name: `${TAG} Check Wrong`, gameId: pcCopy.id, matchedGameId: psCopy.id }],
      noMatch: 2,
      ambiguous: 1,
    });

    // The pick itself: one PlayStation-family game (by platform or by a psn link).
    expect(pickPsnMatch([])).toBeNull();
    expect(pickPsnMatch([{ input: "x", id: "a", platforms: ["PC"], links: [] }])).toBeNull();
    expect(pickPsnMatch([{ input: "x", id: "a", platforms: ["PC"], links: ["psn"] }])).toBe("a");
    expect(
      pickPsnMatch([
        { input: "x", id: "a", platforms: ["PLAYSTATION"], links: [] },
        { input: "x", id: "a", platforms: ["PLAYSTATION"], links: [] },
        { input: "x", id: "b", platforms: ["PC"], links: [] },
      ]),
    ).toBe("a");
    expect(
      pickPsnMatch([
        { input: "x", id: "a", platforms: ["PLAYSTATION"], links: [] },
        { input: "x", id: "b", platforms: ["PS5"], links: [] },
      ]),
    ).toBe("ambiguous");
  });
});
