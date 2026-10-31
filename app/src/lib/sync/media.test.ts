import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { IgdbApi, IgdbMedia, SgdbApi } from "@/lib/integrations";

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
const SLUG = "test-media-game";
const APP_ID = 97100001;

function deps(media: IgdbMedia, art: Awaited<ReturnType<SgdbApi["getArt"]>> = {}) {
  const igdb: IgdbApi = {
    findBySteamAppId: vi.fn(async () => null),
    findByName: vi.fn(async () => null),
    getMedia: vi.fn(async () => media),
  };
  const sgdb: SgdbApi = { getArt: vi.fn(async () => art) };
  return { igdb, sgdb };
}

describe.skipIf(!reachable)("syncGameMedia", () => {
  let gameId = "";

  const cleanup = async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.game.deleteMany({ where: { slug: SLUG } });
  };

  beforeAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    const game = await prisma.game.create({
      data: {
        slug: SLUG,
        name: "Test media game",
        steamAppId: APP_ID,
        igdbId: 555,
        platforms: ["PC"],
        achievementCount: 0,
        media: {
          create: [
            { kind: "video", source: "fixture", order: 0 },
            { kind: "screenshot", source: "fixture", order: 0 },
            { kind: "artwork", source: "fixture", order: 0 },
          ],
        },
      },
    });
    gameId = game.id;
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("keeps fixture media when the sources have nothing", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncGameMedia } = await import("./media");
    await expect(syncGameMedia(gameId, deps({ videos: [], screenshots: [], artworks: [] }))).resolves.toBe(0);
    expect(await prisma.gameMedia.count({ where: { gameId, source: "fixture" } })).toBe(3);
  });

  it("replaces only the kinds the sources returned, in order, and skips non-https art", async () => {
    const { prisma } = await import("@/lib/db");
    const { syncGameMedia } = await import("./media");
    const d = deps(
      {
        videos: [{ youtubeId: "UAO2urG23S4", name: "Trailer" }],
        screenshots: [
          { imageId: "sc1", width: 1920, height: 1080 },
          { imageId: "sc2", width: null, height: null },
        ],
        artworks: [],
      },
      { coverUrl: "https://cdn2.steamgriddb.com/grid/a.png", heroUrl: "http://insecure/h.png" },
    );
    await expect(syncGameMedia(gameId, d)).resolves.toBe(4);
    expect(d.igdb.getMedia).toHaveBeenCalledWith(555);
    expect(d.sgdb.getArt).toHaveBeenCalledWith(APP_ID);

    const rows = await prisma.gameMedia.findMany({ where: { gameId }, orderBy: [{ kind: "asc" }, { order: "asc" }] });
    expect(rows.map((r) => [r.kind, r.source, r.order, r.url ?? r.youtubeId])).toEqual([
      ["artwork", "fixture", 0, null], // untouched: IGDB had no artworks
      ["cover", "sgdb", 0, "https://cdn2.steamgriddb.com/grid/a.png"],
      ["screenshot", "igdb", 0, "https://images.igdb.com/igdb/image/upload/t_1080p/sc1.jpg"],
      ["screenshot", "igdb", 1, "https://images.igdb.com/igdb/image/upload/t_1080p/sc2.jpg"],
      ["video", "igdb", 0, "UAO2urG23S4"],
    ]);

    // Running again replaces instead of duplicating.
    await syncGameMedia(gameId, d);
    expect(await prisma.gameMedia.count({ where: { gameId } })).toBe(5);
  });

  it("returns null for an unknown game", async () => {
    const { syncGameMedia } = await import("./media");
    await expect(syncGameMedia("missing", deps({ videos: [], screenshots: [], artworks: [] }))).resolves.toBeNull();
  });
});
