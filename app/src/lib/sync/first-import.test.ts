import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

// Uses the offline PSN fixtures (no keys in tests) against the seeded catalog.
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

const HANDLE_PREFIX = "test_import_";
const PUBLIC_PSN = "9000000000000000002";
const PRIVATE_PSN = "9000000000000000003";
const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!reachable)("first imports", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    const { releaseImportLease } = await import("./import-lease");
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
    await releaseImportLease();
  }

  async function psnUser(externalId: string, lastSyncAttemptAt: Date | null = null) {
    const { prisma } = await import("@/lib/db");
    counter++;
    // The fixtures have one account per profile: free it from earlier test users.
    await prisma.linkedAccount.deleteMany({
      where: { platform: "psn", externalId, user: { handle: { startsWith: "test_" } } },
    });
    return prisma.user.create({
      data: {
        handle: `${HANDLE_PREFIX}${counter}`,
        displayName: "Teste",
        linkedAccounts: { create: { platform: "psn", externalId, handle: "Tralked-Teste", lastSyncAttemptAt } },
      },
    });
  }

  const account = async (userId: string) => {
    const { prisma } = await import("@/lib/db");
    return prisma.linkedAccount.findUniqueOrThrow({ where: { userId_platform: { userId, platform: "psn" } } });
  };

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("the lease lists the accounts in progress until it expires or is released", async () => {
    const { busyImports, busyPairs, holdImportLease, importKey, releaseImportLease, IMPORT_WORKER_LEASE_MS } =
      await import("./import-lease");
    const now = Date.now();
    await holdImportLease([importKey("psn", "u1"), importKey("steam", "u2")], now);
    expect(busyPairs(await busyImports(now))).toEqual([
      { platform: "psn", userId: "u1" },
      { platform: "steam", userId: "u2" },
    ]);
    expect(await busyImports(now + IMPORT_WORKER_LEASE_MS + 1)).toEqual(new Set());
    await releaseImportLease();
    expect(await busyImports(now)).toEqual(new Set());
  });

  it("a job reserves its own keys beside the worker's and releases only those", async () => {
    const { busyImports, holdImportLease, importKey, releaseImportKeys, releaseImportLease, renewImportKeys, reserveImportKeys } =
      await import("./import-lease");
    const now = Date.now();
    const worker = importKey("psn", "u1");
    await holdImportLease([worker], now);
    await expect(reserveImportKeys([worker, importKey("xbox", "u1")], now)).resolves.toEqual({
      taken: [importKey("xbox", "u1")],
      held: [worker],
    });
    expect(await busyImports(now)).toEqual(new Set([worker, importKey("xbox", "u1")]));
    // The worker rewrites the lease with its own list: the job's renewal puts its key back.
    await holdImportLease([worker], now);
    await renewImportKeys([importKey("xbox", "u1")], now);
    expect(await busyImports(now)).toEqual(new Set([worker, importKey("xbox", "u1")]));
    await releaseImportKeys([importKey("xbox", "u1")], now);
    expect(await busyImports(now)).toEqual(new Set([worker]));
    await releaseImportLease();
    await reserveImportKeys([importKey("psn", "u2")], now);
    await releaseImportKeys([importKey("psn", "u2")], now);
    expect(await busyImports(now)).toEqual(new Set());
  });

  it("the cron leaves alone the accounts the worker is importing", async () => {
    const { holdImportLease, importKey, releaseImportLease } = await import("./import-lease");
    const { syncStalePlatformAccounts } = await import("./platform-user");
    const user = await psnUser(PUBLIC_PSN);
    await holdImportLease([importKey("psn", user.id)]);
    await expect(syncStalePlatformAccounts({ where: { userId: user.id } })).resolves.toEqual({ processed: 0, failed: 0 });
    await releaseImportLease();
    await expect(syncStalePlatformAccounts({ where: { userId: user.id } })).resolves.toEqual({ processed: 1, failed: 0 });
  });

  it("finishes an unfinished import, stops at a private profile, and releases the lease", async () => {
    const { busyImports } = await import("./import-lease");
    const { importCandidates, runFirstImports } = await import("./first-import");
    const open = await psnUser(PUBLIC_PSN);
    const closed = await psnUser(PRIVATE_PSN);
    const only = [open.id, closed.id];
    expect((await importCandidates("psn", only)).map((c) => c.userId).sort()).toEqual([...only].sort());

    const stats = await runFirstImports({ stopAt: Date.now() + 60_000, lanes: ["psn"], only, log: silent });
    expect(stats.psn).toEqual({ finished: 1, slices: 2, stopped: 1, failed: 0 });
    expect((await account(open.id)).lastSyncedAt).not.toBeNull();
    expect((await account(closed.id)).lastSyncedAt).toBeNull();
    // Done: the private one waits for the next run, and the cron may take every account again.
    expect((await importCandidates("psn", only)).map((c) => c.userId)).toEqual([closed.id]);
    expect(await busyImports()).toEqual(new Set());
  });

  it("waits for an account someone else is syncing right now instead of syncing it twice", async () => {
    const { RECENT_ATTEMPT_MS, runFirstImports } = await import("./first-import");
    const start = Date.now();
    const user = await psnUser(PUBLIC_PSN, new Date(start));
    let clock = start;
    const waits: number[] = [];
    const stats = await runFirstImports({
      stopAt: start + 10 * 60_000,
      lanes: ["psn"],
      only: [user.id],
      log: silent,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(RECENT_ATTEMPT_MS);
    expect(stats.psn).toMatchObject({ finished: 1, slices: 1 });
  });

  it("a failing account is left for a later run without stopping the lane", async () => {
    const { getPsn } = await import("@/lib/integrations");
    const { runFirstImports } = await import("./first-import");
    const user = await psnUser(PUBLIC_PSN);
    const titles = vi.spyOn(getPsn(), "getTitles").mockRejectedValue(new Error("PSN titles failed with HTTP 503"));
    try {
      const stats = await runFirstImports({ stopAt: Date.now() + 60_000, lanes: ["psn"], only: [user.id], log: silent });
      expect(stats.psn).toEqual({ finished: 0, slices: 0, stopped: 0, failed: 1 });
    } finally {
      titles.mockRestore();
    }
    expect((await account(user.id)).lastSyncedAt).toBeNull();
  });

  it("a lost database connection is not the account's fault: the turn runs again and the import finishes", async () => {
    const { getPsn } = await import("@/lib/integrations");
    const { runFirstImports } = await import("./first-import");
    const { createDbRetry } = await import("@/lib/worker/db-retry");
    const user = await psnUser(PUBLIC_PSN);
    const lost = Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientKnownRequestError", code: "P1017" });
    const titles = vi.spyOn(getPsn(), "getTitles").mockRejectedValueOnce(lost);
    const warnings: string[] = [];
    const sleeps: number[] = [];
    const withDb = createDbRetry({
      log: { info: () => {}, warn: (m) => warnings.push(m) },
      sleep: async (ms) => void sleeps.push(ms),
    });
    try {
      const stats = await runFirstImports({ stopAt: Date.now() + 60_000, lanes: ["psn"], only: [user.id], log: silent, withDb });
      expect(stats.psn).toEqual({ finished: 1, slices: 1, stopped: 0, failed: 0 });
    } finally {
      titles.mockRestore();
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^PSN lane: database connection lost, retry 1\/7/);
    expect(sleeps).toEqual([5_000]);
    expect((await account(user.id)).lastSyncedAt).not.toBeNull();
  });
});
