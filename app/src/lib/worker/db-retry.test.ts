import { describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { createDbRetry, DatabaseUnavailableError, retryDelay } from "./db-retry";
import { dbFailureKind, describeError } from "./errors";

const lost = () => Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientKnownRequestError", code: "P1017" });

function harness(probeResults: unknown[] = []) {
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  let probes = 0;
  const withDb = createDbRetry({
    log: { info: (m) => infos.push(m), warn: (m) => warnings.push(m) },
    attempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 3_000,
    sleep: async (ms) => void sleeps.push(ms),
    probe: async () => {
      const result = probeResults[probes++];
      if (result instanceof Error) throw result;
    },
  });
  return { withDb, sleeps, warnings, infos, probes: () => probes };
}

describe("retryDelay", () => {
  it("doubles from the base up to the ceiling", () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(n, 5_000, 60_000))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
  });
});

describe("createDbRetry", () => {
  it("returns the unit's result without waiting when nothing fails", async () => {
    const h = harness();
    await expect(h.withDb("batch", async () => 42)).resolves.toBe(42);
    expect(h.sleeps).toEqual([]);
  });

  it("waits, probes and runs the unit again after a lost connection", async () => {
    const h = harness();
    let calls = 0;
    const result = await h.withDb("batch", async () => {
      calls++;
      if (calls === 1) throw lost();
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(h.sleeps).toEqual([1_000]);
    expect(h.probes()).toBe(1);
    expect(h.warnings[0]).toMatch(/^batch: database connection lost, retry 1\/3 in 1 s\. PrismaClientKnownRequestError \[P1017\]/);
    expect(h.infos).toEqual(["batch: database back, carrying on"]);
  });

  it("keeps probing with growing pauses while the database is away", async () => {
    const h = harness([lost(), lost(), undefined]);
    let calls = 0;
    await h.withDb("slice", async () => {
      if (calls++ === 0) throw lost();
    });
    expect(h.sleeps).toEqual([1_000, 2_000, 3_000]);
    expect(calls).toBe(2);
  });

  it("gives up after the bounded number of failures in a row", async () => {
    const h = harness([undefined, undefined, undefined, undefined]);
    let calls = 0;
    const run = h.withDb("batch", async () => {
      calls++;
      throw lost();
    });
    await expect(run).rejects.toBeInstanceOf(DatabaseUnavailableError);
    await expect(run).rejects.toMatchObject({ reason: "connection", message: expect.stringMatching(/after 3 attempts/) });
    // First run + one run after each of the 3 successful probes; the 4th failure ends it.
    expect(calls).toBe(4);
    expect(h.sleeps).toEqual([1_000, 2_000, 3_000]);
  });

  it("stops at once when Neon refuses the compute (quota)", async () => {
    const h = harness();
    const run = h.withDb("batch", async () => {
      throw new Error("Your account or project has exceeded the compute time quota.");
    });
    await expect(run).rejects.toMatchObject({ name: "DatabaseUnavailableError", reason: "quota" });
    expect(h.sleeps).toEqual([]);
  });

  it("lets every other error through untouched", async () => {
    const h = harness();
    const bug = new TypeError("bug");
    await expect(h.withDb("batch", async () => Promise.reject(bug))).rejects.toBe(bug);
    expect(h.sleeps).toEqual([]);
  });
});

// Against the real driver: a connection killed in the middle of a query (what a Neon restart or a
// network cut does) is recognized, logged in full, and the retry gets through on a fresh connection.
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

describe.skipIf(!reachable)("createDbRetry against Postgres", () => {
  it("recovers from a connection terminated mid-query", async () => {
    const { prisma } = await import("@/lib/db");
    const { Client } = await import("pg");
    const admin = new Client({ connectionString: env.DATABASE_URL });
    await admin.connect();
    const marker = `db_retry_${Date.now()}`;
    const kill = async () => {
      // Wait until the query is running, then end its backend as a server restart would.
      for (let i = 0; i < 50; i++) {
        const { rowCount } = await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE $1 AND query NOT LIKE '%pg_stat_activity%'`,
          [`%${marker}%`],
        );
        if (rowCount) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("the test query never showed up");
    };
    try {
      const sleepQuery = () => prisma.$queryRawUnsafe(`SELECT pg_sleep(5), '${marker}' AS marker`);
      const killed = kill();
      const failure = await sleepQuery().then(
        () => null,
        (error: unknown) => error,
      );
      await killed;
      expect(failure).not.toBeNull();
      expect(dbFailureKind(failure)).toBe("connection");
      // Prisma 7 reports it as P2010 with the driver's error (Postgres 57P01) in `meta`.
      expect(describeError(failure, { stack: false })).toMatch(/57P01/);

      const warnings: string[] = [];
      const withDb = createDbRetry({ log: { info: () => {}, warn: (m) => warnings.push(m) }, baseDelayMs: 50, maxDelayMs: 50 });
      let calls = 0;
      const rows = await withDb("test", async () => {
        calls++;
        if (calls === 1) {
          const killedAgain = kill();
          try {
            return await sleepQuery();
          } finally {
            await killedAgain;
          }
        }
        return prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
      });
      expect(rows).toEqual([{ ok: 1 }]);
      expect(calls).toBe(2);
      expect(warnings).toHaveLength(1);
    } finally {
      await admin.end();
    }
  });
});
