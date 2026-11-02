import { prisma } from "@/lib/db";
import { slugSchema } from "@/lib/content/guide-schema";
import { safeImageUrl } from "@/lib/content/url";
import { wideArt } from "@/lib/queries/company-art";

/**
 * The official media the catalog already stores for a game (IGDB, SteamGridDB, Steam), for robots
 * that need an image or a trailer for an article: wide images only (hero, screenshots, artworks;
 * never the portrait cover or the logo) and YouTube video ids. Read-only, public catalog data.
 */

/** At most this many images and videos per answer. */
export const MEDIA_IMAGE_CAP = 12;
export const MEDIA_VIDEO_CAP = 6;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const IMAGE_KINDS = ["screenshot", "artwork"] as const;

export type GameMediaImage = {
  url: string;
  /** hero (the game's wide banner), screenshot or artwork. */
  kind: "hero" | "screenshot" | "artwork";
  width: number | null;
  height: number | null;
  /** Where the catalog got it: igdb, sgdb, steam… (null for the hero, whose origin is not stored). */
  source: string | null;
};

export type GameMediaSet = {
  game: { slug: string; name: string; developer: string | null; publisher: string | null };
  /** Hero first, then screenshots, then artworks, each in catalog order; https only, no repeats. */
  images: GameMediaImage[];
  /** Catalog order (IGDB lists the main trailer first). */
  videos: { youtubeId: string }[];
};

/** Media of the game, or null when the slug is malformed, unknown or a catalog stub. */
export async function gameMedia(slug: string): Promise<GameMediaSet | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const game = await prisma.game.findUnique({
    where: { slug: parsed.data },
    select: {
      id: true,
      stub: true,
      slug: true,
      name: true,
      developer: true,
      publisher: true,
      heroUrl: true,
      media: {
        where: { OR: [{ kind: { in: [...IMAGE_KINDS] }, url: { not: null } }, { kind: "video", youtubeId: { not: null } }] },
        orderBy: [{ kind: "asc" }, { order: "asc" }, { id: "asc" }],
        select: { kind: true, url: true, youtubeId: true, width: true, height: true, source: true },
      },
    },
  });
  if (!game || game.stub) return null;

  const images: GameMediaImage[] = [];
  const seen = new Set<string>();
  const addImage = (raw: string | null, image: Omit<GameMediaImage, "url">) => {
    const safe = safeImageUrl(raw);
    // Absolute https only: a same-site path means nothing to a robot.
    if (!safe || !safe.startsWith("https://")) return;
    const url = wideArt(safe);
    if (seen.has(url) || images.length >= MEDIA_IMAGE_CAP) return;
    seen.add(url);
    images.push({ url, ...image });
  };

  addImage(game.heroUrl, { kind: "hero", width: null, height: null, source: null });
  for (const kind of IMAGE_KINDS) {
    for (const m of game.media) {
      if (m.kind === kind) addImage(m.url, { kind, width: m.width, height: m.height, source: m.source });
    }
  }

  const videos: { youtubeId: string }[] = [];
  for (const m of game.media) {
    if (m.kind !== "video" || !m.youtubeId || !YOUTUBE_ID.test(m.youtubeId)) continue;
    if (videos.some((v) => v.youtubeId === m.youtubeId)) continue;
    videos.push({ youtubeId: m.youtubeId });
    if (videos.length >= MEDIA_VIDEO_CAP) break;
  }

  return {
    game: { slug: game.slug, name: game.name, developer: game.developer, publisher: game.publisher },
    images,
    videos,
  };
}
