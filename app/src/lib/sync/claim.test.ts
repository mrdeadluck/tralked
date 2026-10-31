import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { claimSyncSlot, MIN_SYNC_INTERVAL_MS } from "@/lib/sync/claim";

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

describe.skipIf(!reachable)("claimSyncSlot (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("refuses a second sync within 2 minutes and allows it afterwards", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    const seen: boolean[] = [];
    // Rolled-back transaction: the seeded user is never changed for other tests.
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { handle: "lucas" } });
        const t0 = new Date("2026-10-31T12:00:00Z");
        const at = (ms: number) => new Date(t0.getTime() + ms);
        await tx.user.update({ where: { id: user.id }, data: { lastSyncAttemptAt: null } });

        seen.push(await claimSyncSlot(user.id, t0, tx)); // never attempted: allowed
        seen.push(await claimSyncSlot(user.id, at(30_000), tx)); // 30 s later: refused
        seen.push(await claimSyncSlot(user.id, at(MIN_SYNC_INTERVAL_MS - 1), tx)); // just under 2 min: refused
        // syncUser re-stamping the attempt a moment after the claim only moves the window forward.
        await tx.user.update({ where: { id: user.id }, data: { lastSyncAttemptAt: at(5_000) } });
        seen.push(await claimSyncSlot(user.id, at(MIN_SYNC_INTERVAL_MS), tx)); // 115 s after the re-stamp: refused
        seen.push(await claimSyncSlot(user.id, at(5_000 + MIN_SYNC_INTERVAL_MS + 1), tx)); // allowed
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen).toEqual([true, false, false, false, true]);
  });
});
