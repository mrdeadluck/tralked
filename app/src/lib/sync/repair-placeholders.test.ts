import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { SteamApi } from "@/lib/integrations";

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

const APP = 97_500_000;
const LEGACY_OWNED = APP + 1; // "Steam App <n>", listed, owned: name from the owner's library
const NEW_STUB = APP + 2; // "Jogo <n> da Steam" stub, owned
const LEGACY_STORE = APP + 3; // "Steam App <n>", nobody owns it: name from the store (slug taken)
const LEGACY_UNKNOWN = APP + 4; // nobody knows it: becomes a stub
const HANDLE = "test_repair_placeholder";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe.skipIf(!reachable)("repairPlaceholderGames", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: HANDLE } });
    await prisma.game.deleteMany({
      where: { OR: [{ steamAppId: { gte: APP, lt: APP + 100 } }, { slug: "silent-hill-2" }] },
    });
  }
  beforeAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    const game = (appId: number, name: string, slug: string, stub: boolean) =>
      prisma.game.create({ data: { steamAppId: appId, name, slug, stub, platforms: ["PC"], achievementCount: 3 } });
    const owned = await game(LEGACY_OWNED, `Steam App ${LEGACY_OWNED}`, `steam-app-${LEGACY_OWNED}`, false);
    const stub = await game(NEW_STUB, `Jogo ${NEW_STUB} da Steam`, `jogo-${NEW_STUB}-da-steam`, true);
    await game(LEGACY_STORE, `Steam App ${LEGACY_STORE}`, `steam-app-${LEGACY_STORE}`, false);
    await game(LEGACY_UNKNOWN, `Steam App ${LEGACY_UNKNOWN}`, `steam-app-${LEGACY_UNKNOWN}`, false);
    // A real game holding the slug the store name would take, and one that must never change.
    await prisma.game.create({ data: { name: "Silent Hill 2 (editorial)", slug: "silent-hill-2", platforms: ["PC"], achievementCount: 0 } });
    await game(APP + 5, "Um Nome Real", `um-nome-real-${APP + 5}`, false);
    await prisma.user.create({
      data: {
        handle: HANDLE,
        displayName: "Dono",
        steamId: "test-repair-steam",
        games: {
          create: [owned, stub].map((g) => ({ gameId: g.id, platform: "steam", playtimeMin: 100, unlockedCount: 0 })),
        },
      },
    });
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  function deps() {
    const steam = {
      getOwnedGames: vi.fn(async () => [
        { appId: LEGACY_OWNED, playtimeMin: 100, name: "FINAL FANTASY VII REBIRTH" },
        { appId: NEW_STUB, playtimeMin: 100, name: "Jogo Bom™" },
      ]),
    } as unknown as SteamApi;
    const politeFetch = vi.fn(async (url: string) => {
      const appId = Number(new URL(url).searchParams.get("appids"));
      expect(new URL(url).searchParams.get("filters")).toBe("basic");
      return appId === LEGACY_STORE
        ? json({ [appId]: { success: true, data: { type: "game", name: "SILENT HILL 2" } } })
        : json({ [appId]: { success: false } });
    });
    const lines: string[] = [];
    return { steam, politeFetch, lines, deps: { steam, politeFetch, log: (m: string) => lines.push(m), now: () => new Date("2026-11-02T10:00:00Z") } };
  }

  it("dry run reports every change and writes nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { repairPlaceholderGames } = await import("./repair-placeholders");
    const { deps: d, lines } = deps();
    const before = await prisma.game.findMany({ where: { steamAppId: { gte: APP, lt: APP + 100 } }, orderBy: { steamAppId: "asc" } });
    const result = await repairPlaceholderGames({ dryRun: true, deps: d });
    expect(result).toMatchObject({ found: 4, renamed: 3, fromLibrary: 2, fromStore: 1, stubbed: 1, failed: 0 });
    expect(lines.some((l) => l.includes("FINAL FANTASY VII REBIRTH") && l.includes("[dry run]"))).toBe(true);
    const after = await prisma.game.findMany({ where: { steamAppId: { gte: APP, lt: APP + 100 } }, orderBy: { steamAppId: "asc" } });
    expect(after).toEqual(before);
  });

  it("renames from the owners' library, then the store; queues details; unknown ones become stubs; idempotent", async () => {
    const { prisma } = await import("@/lib/db");
    const { repairPlaceholderGames } = await import("./repair-placeholders");
    const { deps: d, politeFetch, steam } = deps();
    const result = await repairPlaceholderGames({ dryRun: false, deps: d });
    expect(result).toMatchObject({ found: 4, renamed: 3, fromLibrary: 2, fromStore: 1, stubbed: 1 });
    // One library read for the owner; the store only for the games no library named.
    expect(steam.getOwnedGames).toHaveBeenCalledTimes(1);
    expect(politeFetch.mock.calls.map(([url]) => Number(new URL(url).searchParams.get("appids"))).sort()).toEqual([
      LEGACY_STORE,
      LEGACY_UNKNOWN,
    ]);

    const byApp = async (appId: number) => prisma.game.findUniqueOrThrow({ where: { steamAppId: appId } });
    expect(await byApp(LEGACY_OWNED)).toMatchObject({
      name: "FINAL FANTASY VII REBIRTH",
      slug: "final-fantasy-vii-rebirth",
      stub: false,
      detailsRequestedAt: new Date("2026-11-02T10:00:00Z"),
    });
    expect(await byApp(NEW_STUB)).toMatchObject({ name: "Jogo Bom", slug: "jogo-bom", stub: true });
    // Slug taken by another game: the appid is appended.
    expect(await byApp(LEGACY_STORE)).toMatchObject({ name: "SILENT HILL 2", slug: `silent-hill-2-${LEGACY_STORE}` });
    expect(await byApp(LEGACY_UNKNOWN)).toMatchObject({ name: `Steam App ${LEGACY_UNKNOWN}`, stub: true });
    expect(await byApp(APP + 5)).toMatchObject({ name: "Um Nome Real", slug: `um-nome-real-${APP + 5}`, detailsRequestedAt: null });
    expect(await prisma.game.findUniqueOrThrow({ where: { slug: "silent-hill-2" } })).toMatchObject({ name: "Silent Hill 2 (editorial)" });

    // Again: only the still-unknown one is looked at, and nothing else changes.
    const again = await repairPlaceholderGames({ dryRun: false, deps: deps().deps });
    expect(again).toMatchObject({ found: 1, renamed: 0, stubbed: 1 });
    expect(await byApp(LEGACY_OWNED)).toMatchObject({ slug: "final-fantasy-vii-rebirth" });
  });
});
