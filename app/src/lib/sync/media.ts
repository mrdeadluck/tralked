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
  /** Videos: IGDB's name of the video ("Trailer", "Gameplay"). */
  title?: string | null;
};

export type MediaDeps = { igdb: IgdbApi; sgdb: SgdbApi };

const igdbImage = (size: string, imageId: string) => `${IGDB_IMAGE}/${size}/${imageId}.jpg`;

/**
 * Refreshes a game's official media: trailers, screenshots and artworks from IGDB, and
 * cover/capsule/hero/logo (with sizes) from SteamGridDB (Steam games only). Each kind is replaced only when the
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
      title: v.name?.trim() || null,
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
  for (const [kind, asset] of [
    ["cover", art?.cover ?? (art?.coverUrl ? { url: art.coverUrl } : undefined)],
    ["capsule", art?.capsule],
    ["hero", art?.hero ?? (art?.heroUrl ? { url: art.heroUrl } : undefined)],
    ["logo", art?.logo ?? (art?.logoUrl ? { url: art.logoUrl } : undefined)],
  ] as const) {
    if (asset?.url.startsWith("https://")) {
      const size = asset as { width?: number | null; height?: number | null };
      rows.push({ kind, url: asset.url, youtubeId: null, width: size.width ?? null, height: size.height ?? null, source: "sgdb" });
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
    // Steam's own art (the store sync's rows) stays: only what these sources wrote is replaced.
    prisma.gameMedia.deleteMany({
      where: { gameId: game.id, kind: { in: [...nextOrder.keys()] }, source: { not: "steam" } },
    }),
    prisma.gameMedia.createMany({ data }),
  ]);
  return rows.length;
}

/** A game IGDB had no media for is asked again only after this long (IGDB keeps growing). */
export const MEDIA_RECHECK_MS = 30 * 24 * 60 * 60_000;

/**
 * Games still without official IGDB media and not asked lately: listed games only (stubs of the
 * full Steam catalog wait for their store details first).
 */
export function mediaQueue(now: Date) {
  return {
    stub: false,
    media: { none: { source: "igdb" } },
    OR: [{ mediaCheckedAt: null }, { mediaCheckedAt: { lt: new Date(now.getTime() - MEDIA_RECHECK_MS) } }],
  };
}

/** Records a media attempt (with or without results), so the queue moves on. */
export async function markMediaChecked(gameId: string, now = new Date()): Promise<void> {
  await prisma.game.updateMany({ where: { id: gameId }, data: { mediaCheckedAt: now } });
}

/**
 * Cron job: fills the official media of `limit` games that have none from IGDB yet: the most
 * popular half first, the rest at random among the candidates.
 */
export async function syncStaleMedia(limit = 20): Promise<{ processed: number; failed: number }> {
  const candidates = await prisma.game.findMany({
    // Stubs of the full Steam catalog (name only) wait for their store details first.
    where: mediaQueue(new Date()),
    select: { id: true, popularity: true },
  });
  // Half the run goes to the most popular games (those the news and players show most), the other
  // half is picked at random so games IGDB has nothing for cannot starve the rest.
  const popular = [...candidates].sort((a, b) => b.popularity - a.popularity).slice(0, Math.ceil(limit / 2));
  const chosen = new Set(popular.map((c) => c.id));
  const random = candidates
    .filter((c) => !chosen.has(c.id))
    .map((c) => ({ id: c.id, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, limit - popular.length);
  const picked = [...popular, ...random];
  let processed = 0;
  let failed = 0;
  for (const { id } of picked) {
    try {
      await syncGameMedia(id);
      await markMediaChecked(id);
      processed++;
    } catch (error) {
      failed++;
      console.error(`Media: could not sync game ${id}`, error);
      await markMediaChecked(id).catch(() => {});
    }
  }
  return { processed, failed };
}
