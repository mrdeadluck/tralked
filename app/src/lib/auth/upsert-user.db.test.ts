import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Real Prisma against the test database (the Steam fixture answers the player summary).
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
const STEAM_ID = "76561190000000777";

describe.skipIf(!reachable)("upsertUserFromSteam (database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { steamId: STEAM_ID } });
    await prisma.$disconnect();
  });

  it("creates a verified Steam LinkedAccount on first login and keeps it on the next", async () => {
    const { prisma } = await import("@/lib/db");
    const { upsertUserFromSteam } = await import("./upsert-user");
    await prisma.user.deleteMany({ where: { steamId: STEAM_ID } });

    const user = await upsertUserFromSteam(STEAM_ID);
    const first = await prisma.linkedAccount.findUniqueOrThrow({
      where: { userId_platform: { userId: user.id, platform: "steam" } },
    });
    expect(first.externalId).toBe(STEAM_ID);
    expect(first.verifiedAt).not.toBeNull();

    // A user from before the mirror existed (no LinkedAccount) gets one on the next login.
    await prisma.linkedAccount.deleteMany({ where: { userId: user.id } });
    await upsertUserFromSteam(STEAM_ID);
    await upsertUserFromSteam(STEAM_ID);
    const rows = await prisma.linkedAccount.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: "steam", externalId: STEAM_ID });
  });
});
