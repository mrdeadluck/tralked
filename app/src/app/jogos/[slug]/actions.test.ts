import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

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
const HANDLE = "test-game-open";

describe.skipIf(!reachable)("markOpened", async () => {
  const { prisma } = await import("@/lib/db");
  const { markOpened } = await import("./actions");
  let userId = "";
  let gameId = "";

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { handle: HANDLE } });
    userId = (await prisma.user.create({ data: { handle: HANDLE, displayName: "Teste" } })).id;
    gameId = (await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { handle: HANDLE } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    getSessionUser.mockReset();
  });

  it("requires login and writes nothing without it", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await markOpened(gameId)).toEqual({ status: "unauthenticated" });
    expect(await prisma.gameOpen.count({ where: { gameId, userId } })).toBe(0);
  });

  it("validates the game id and refuses unknown games", async () => {
    getSessionUser.mockResolvedValue({ id: userId, handle: HANDLE });
    for (const bad of ["", "<script>", 42, null, { id: gameId }, "x".repeat(65)]) {
      expect(await markOpened(bad)).toEqual({ status: "invalid" });
    }
    expect(await markOpened("nao-existe")).toEqual({ status: "not_found" });
    expect(await prisma.gameOpen.count({ where: { userId } })).toBe(0);
  });

  it("is idempotent: one row, the first openedAt kept", async () => {
    getSessionUser.mockResolvedValue({ id: userId, handle: HANDLE });
    expect(await markOpened(gameId)).toEqual({ status: "ok" });
    const first = await prisma.gameOpen.findUniqueOrThrow({ where: { userId_gameId: { userId, gameId } } });
    expect(await markOpened(gameId)).toEqual({ status: "ok" });
    expect(await markOpened(gameId)).toEqual({ status: "ok" });
    const rows = await prisma.gameOpen.findMany({ where: { userId, gameId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].openedAt).toEqual(first.openedAt);

    // The per-user profile now says opened (the intro will not play on any device).
    const { getGameProfileForUser } = await import("@/lib/queries/game-profile");
    expect((await getGameProfileForUser("hollow-knight", userId))?.opened).toBe(true);
  });
});
