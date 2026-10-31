import { prisma } from "@/lib/db";
import { getIgdb, getSgdb, type IgdbApi, type SgdbApi } from "@/lib/integrations";

const IGDB_IMAGE = "https://images.igdb.com/igdb/image/upload";
const MAX_VIDEOS = 6;
const MAX_SCREENSHOTS = 12;
const MAX_ARTWORKS = 8;

type MediaRow = {
  kind: string;
  url: string | null;
  youtubeId: string | null;
  width: number | null;
  height: number | null;
  source: string;
};

export type MediaDeps = { igdb: IgdbApi; sgdb: SgdbApi };

const igdbImage = (size: string, imageId: string) => `${IGDB_IMAGE}/${size}/${imageId}.jpg`;

/**
 * Refreshes a game's official media: trailers, screenshots and artworks from IGDB, and
 * cover/hero/logo from SteamGridDB (Steam games only). Each kind is replaced only when the
 * sources returned something for it, so the seeded fixture media (generated art) stays until
 * real media exists. Returns how many rows were written, or null for an unknown game.
 */
export async function syncGameMedia(
  gameId: string,
  deps: MediaDeps = { igdb: getIgdb(), sgdb: getSgdb() },
): Promise<number | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, name: true, igdbId: true, steamAppId: true },
  });
  if (!game) return null;

  let igdbId = game.igdbId;
  if (igdbId === null) {
    const found =
      game.steamAppId !== null
        ? await deps.igdb.findBySteamAppId(game.steamAppId)
        : await deps.igdb.findByName(game.name);
    if (found) {
      igdbId = found.igdbId;
      await prisma.game.update({ where: { id: game.id }, data: { igdbId } });
    }
  }

  const [media, art] = await Promise.all([
    igdbId !== null ? deps.igdb.getMedia(igdbId) : null,
    game.steamAppId !== null ? deps.sgdb.getArt(game.steamAppId) : null,
  ]);

  const rows: MediaRow[] = [
    ...(media?.videos ?? []).slice(0, MAX_VIDEOS).map((v) => ({
      kind: "video",
      url: null,
      youtubeId: v.youtubeId,
      width: null,
      height: null,
      source: "igdb",
    })),
    ...(media?.screenshots ?? []).slice(0, MAX_SCREENSHOTS).map((s) => ({
      kind: "screenshot",
      url: igdbImage("t_1080p", s.imageId),
      youtubeId: null,
      width: s.width,
      height: s.height,
      source: "igdb",
    })),
    ...(media?.artworks ?? []).slice(0, MAX_ARTWORKS).map((a) => ({
      kind: "artwork",
      url: igdbImage("t_1080p", a.imageId),
      youtubeId: null,
      width: a.width,
      height: a.height,
      source: "igdb",
    })),
  ];
  for (const [kind, url] of [
    ["cover", art?.coverUrl],
    ["hero", art?.heroUrl],
    ["logo", art?.logoUrl],
  ] as const) {
    if (url?.startsWith("https://")) {
      rows.push({ kind, url, youtubeId: null, width: null, height: null, source: "sgdb" });
    }
  }
  if (rows.length === 0) return 0;

  const nextOrder = new Map<string, number>();
  const data = rows.map((row) => {
    const order = nextOrder.get(row.kind) ?? 0;
    nextOrder.set(row.kind, order + 1);
    return { ...row, gameId: game.id, order };
  });
  await prisma.$transaction([
    prisma.gameMedia.deleteMany({ where: { gameId: game.id, kind: { in: [...nextOrder.keys()] } } }),
    prisma.gameMedia.createMany({ data }),
  ]);
  return rows.length;
}

/**
 * Cron job: fills the official media of `limit` games that have none from IGDB yet, picked at
 * random among the candidates so games IGDB has nothing for cannot starve the rest.
 */
export async function syncStaleMedia(limit = 20): Promise<{ processed: number; failed: number }> {
  const candidates = await prisma.game.findMany({
    // Stubs of the full Steam catalog (name only) wait for their store details first.
    where: { stub: false, media: { none: { source: "igdb" } } },
    select: { id: true },
  });
  const picked = candidates
    .map((c) => ({ id: c.id, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, limit);
  let processed = 0;
  let failed = 0;
  for (const { id } of picked) {
    try {
      await syncGameMedia(id);
      processed++;
    } catch (error) {
      failed++;
      console.error(`Media: could not sync game ${id}`, error);
    }
  }
  return { processed, failed };
}
