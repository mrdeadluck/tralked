import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

// Needs Postgres up (see db.test.ts); skipped when unreachable.
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
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

// Real Steam and IGDB clients against a stubbed network; RAWG and SteamGridDB stay on fixtures.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const keys = { STEAM_API_KEY: "steam-key", IGDB_CLIENT_ID: "igdb-id" } as const;
  return {
    ...actual,
    env: { ...actual.env, ...keys, IGDB_CLIENT_SECRET: "igdb-secret" },
    hasKey: (name: string) => name in keys,
  };
});

const APP_A = 95000001;
const APP_B = 95000002;
const where = { steamAppId: { in: [APP_A, APP_B] } };

type Network = { tokenRequests: number; igdbCalls: number[]; igdbStatus: number };
const network: Network = { tokenRequests: 0, igdbCalls: [], igdbStatus: 200 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname === "id.twitch.tv") {
    network.tokenRequests++;
    return json({ access_token: "T", expires_in: 3600 });
  }
  if (url.hostname === "api.igdb.com") {
    network.igdbCalls.push(Date.now());
    return network.igdbStatus === 200 ? json([]) : json({}, network.igdbStatus);
  }
  if (url.pathname.includes("GetSchemaForGame")) {
    return json({ game: { availableGameStats: { achievements: [{ name: "A0", displayName: "A0" }] } } });
  }
  if (url.pathname.includes("GetGlobalAchievementPercentagesForApp")) {
    return json({ achievementpercentages: { achievements: [{ name: "A0", percent: "10" }] } });
  }
  throw new Error(`unexpected request ${url.origin}${url.pathname}`);
}

describe.skipIf(!reachable)("syncGame with the real IGDB client", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where });
  }

  beforeAll(cleanup);
  beforeEach(async () => {
    const { resetIntegrations } = await import("@/lib/integrations");
    resetIntegrations();
    Object.assign(network, { tokenRequests: 0, igdbCalls: [], igdbStatus: 200 });
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup();
  });
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("shares one token and one rate limiter across separate syncGame calls", async () => {
    const { syncGame } = await import("./catalog");

    await Promise.all([syncGame(APP_A), syncGame(APP_B)]);

    expect(network.tokenRequests).toBe(1);
    expect(network.igdbCalls).toHaveLength(2);
    const [first, second] = [...network.igdbCalls].sort((a, b) => a - b);
    // 4 req/s: the second request starts at least ~250ms after the first (timer slack allowed).
    expect(second - first).toBeGreaterThanOrEqual(240);
  });

  it("does not create a game without skills when IGDB keeps answering 429", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncGame } = await import("./catalog");
    const { IgdbRateLimitError } = await import("@/lib/integrations/igdb/client");
    network.igdbStatus = 429;

    await expect(syncGame(APP_A)).rejects.toBeInstanceOf(IgdbRateLimitError);

    expect(network.igdbCalls).toHaveLength(2); // the first attempt and one retry
    expect(await prisma.game.count({ where: { steamAppId: APP_A } })).toBe(0);
  });
});
