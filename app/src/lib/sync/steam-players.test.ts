import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { steamPlayersView } from "@/lib/queries/steam-players";
import { fetchCurrentPlayers, samplePlayers, SteamThrottledError } from "./steam-players";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fetchFrom(handler: (appId: number) => Response) {
  return vi.fn(async (input: RequestInfo | URL) => handler(Number(new URL(String(input)).searchParams.get("appid")))) as unknown as typeof fetch;
}

describe("fetchCurrentPlayers", () => {
  it("reads player_count from the keyless endpoint", async () => {
    const fetchImpl = vi.fn(async () => json({ response: { player_count: 1234, result: 1 } }));
    await expect(fetchCurrentPlayers(570, fetchImpl as unknown as typeof fetch)).resolves.toBe(1234);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/");
    expect(url.searchParams.get("appid")).toBe("570");
    expect(url.searchParams.has("key")).toBe(false);
  });

  it("returns null when Steam has no count (404, result 42, odd body)", async () => {
    await expect(fetchCurrentPlayers(1, fetchFrom(() => json({}, 404)))).resolves.toBeNull();
    await expect(fetchCurrentPlayers(1, fetchFrom(() => json({ response: { result: 42 } })))).resolves.toBeNull();
    await expect(fetchCurrentPlayers(1, fetchFrom(() => new Response("<html>")))).resolves.toBeNull();
    await expect(fetchCurrentPlayers(1, fetchFrom(() => json({ response: { player_count: -1, result: 1 } })))).resolves.toBeNull();
  });

  it("throws SteamThrottledError on 429 and 5xx", async () => {
    await expect(fetchCurrentPlayers(1, fetchFrom(() => json({}, 429)))).rejects.toBeInstanceOf(SteamThrottledError);
    await expect(fetchCurrentPlayers(1, fetchFrom(() => json({}, 503)))).rejects.toBeInstanceOf(SteamThrottledError);
  });
});

describe("samplePlayers", () => {
  const games = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, steamAppId: i + 1 }));

  it("samples every game with a bounded number of requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      const appId = Number(new URL(String(input)).searchParams.get("appid"));
      return appId % 10 === 0 ? json({ response: { result: 42 } }) : json({ response: { player_count: appId * 100, result: 1 } });
    }) as unknown as typeof fetch;
    const result = await samplePlayers(games, { concurrency: 4, fetchImpl });
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.samples).toHaveLength(27);
    expect(result.missing).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.samples.find((s) => s.gameId === "g4")).toEqual({ gameId: "g4", count: 500 });
  });

  it("stops starting requests once Steam keeps refusing", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429)) as unknown as typeof fetch;
    const result = await samplePlayers(games, { concurrency: 1, maxThrottled: 3, fetchImpl });
    expect(result.throttled).toBe(true);
    expect(result.failed).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("counts network errors as failures and goes on", async () => {
    const fetchImpl = fetchFrom((appId) => {
      if (appId === 2) throw new Error("socket hang up");
      return json({ response: { player_count: 7, result: 1 } });
    });
    const result = await samplePlayers(games.slice(0, 3), { concurrency: 2, fetchImpl });
    expect(result.failed).toBe(1);
    expect(result.samples).toHaveLength(2);
    expect(result.throttled).toBe(false);
  });
});

describe("steamPlayersView", () => {
  // 15:00 in São Paulo on 2026-11-02.
  const now = new Date("2026-11-02T18:00:00Z");
  const row = {
    current: 900,
    sampledAt: new Date("2026-11-02T17:21:00Z"),
    todayPeak: 1200,
    todayPeakDay: new Date("2026-11-02T00:00:00Z"),
    allTimePeak: 5000,
  };

  it("shows now, today's peak and the highest peak for a fresh sample", () => {
    expect(steamPlayersView(row, now)).toEqual({ current: 900, todayPeak: 1200, allTimePeak: 5000 });
  });

  it("drops today's peak once the São Paulo day changed", () => {
    // 00:30 of 2026-11-03 in São Paulo.
    const after = new Date("2026-11-03T03:30:00Z");
    expect(steamPlayersView({ ...row, sampledAt: new Date("2026-11-03T02:21:00Z") }, after)).toEqual({
      current: 900,
      todayPeak: null,
      allTimePeak: 5000,
    });
  });

  it("keeps only the highest peak when the sample is stale, and nothing without data", () => {
    expect(steamPlayersView({ ...row, sampledAt: new Date("2026-11-02T10:00:00Z") }, now)).toEqual({
      current: null,
      todayPeak: null,
      allTimePeak: 5000,
    });
    expect(steamPlayersView(null, now)).toBeNull();
    expect(steamPlayersView({ ...row, sampledAt: new Date("2026-10-01T00:00:00Z"), allTimePeak: 0 }, now)).toBeNull();
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
const SLUG = "test-steam-players-";
const APP = 97_800_000;

describe.skipIf(!reachable)("recordPlayerCounts", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG } } });
  }
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("keeps one row per game: current, the day's peak (reset each day) and the highest peak measured", async () => {
    const { prisma } = await import("@/lib/db");
    const { recordPlayerCounts, topSteamGames } = await import("./steam-players");
    const game = await prisma.game.create({
      data: { slug: `${SLUG}a`, name: "Players A", steamAppId: APP, achievementCount: 0, popularity: 2e9 },
    });
    expect((await topSteamGames(1))[0]).toEqual({ id: game.id, steamAppId: APP });

    const t1 = new Date("2026-11-02T13:00:00Z");
    const t2 = new Date("2026-11-02T14:00:00Z");
    const t3 = new Date("2026-11-02T15:00:00Z");
    // 01:00 of the next day in São Paulo.
    const t4 = new Date("2026-11-03T04:00:00Z");
    await recordPlayerCounts([{ gameId: game.id, count: 100 }], t1);
    await recordPlayerCounts([{ gameId: game.id, count: 300 }], t2);
    await recordPlayerCounts([{ gameId: game.id, count: 200 }, { gameId: "missing-game", count: 5 }], t3);
    let row = await prisma.steamPlayerCount.findUniqueOrThrow({ where: { gameId: game.id } });
    expect(row).toMatchObject({ current: 200, todayPeak: 300, allTimePeak: 300 });
    expect(row.sampledAt).toEqual(t3);
    expect(row.allTimePeakAt).toEqual(t2);
    expect(row.todayPeakDay.toISOString().slice(0, 10)).toBe("2026-11-02");

    await recordPlayerCounts([{ gameId: game.id, count: 50 }], t4);
    row = await prisma.steamPlayerCount.findUniqueOrThrow({ where: { gameId: game.id } });
    expect(row).toMatchObject({ current: 50, todayPeak: 50, allTimePeak: 300 });
    expect(row.todayPeakDay.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(row.allTimePeakAt).toEqual(t2);
    expect(await prisma.steamPlayerCount.count({ where: { gameId: "missing-game" } })).toBe(0);
  });
});
