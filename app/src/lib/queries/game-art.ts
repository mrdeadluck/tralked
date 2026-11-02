import type { Prisma } from "@/generated/prisma/client";
import { artAssets, type ArtAsset } from "@/lib/art/frame";
import { safeImageUrl } from "@/lib/content/url";

/*
 * The art a game's cover needs (lib/case-art + components/art/CoverArt), read the same way in every
 * list: the catalog media first, as the game page does (`cover`, then `hero`), then the columns;
 * a game without a stored hero still has wide art in its official artwork or screenshots. A list
 * that read only `coverUrl` showed generated art for games whose page has real art (a wishlist,
 * God of War III in "Jogou recentemente").
 */

/** Select of a game's art; spread it into any `game: { select }`. One row per media kind. */
export const GAME_ART_SELECT = {
  coverUrl: true,
  heroUrl: true,
  logoUrl: true,
  steamAppId: true,
  media: {
    where: { kind: { in: ["cover", "capsule", "hero", "logo", "artwork", "screenshot"] }, url: { not: null } },
    orderBy: [{ kind: "asc" }, { order: "asc" }],
    distinct: ["kind"],
    select: { kind: true, url: true, width: true, height: true },
  },
} satisfies Prisma.GameSelect;

type ArtRow = {
  coverUrl: string | null;
  heroUrl: string | null;
  logoUrl?: string | null;
  steamAppId: number | null;
  media: { kind: string; url: string | null; width?: number | null; height?: number | null }[];
};

export type GameArtUrls = {
  coverUrl: string | null;
  heroUrl: string | null;
  steamAppId: number | null;
  /** Every image by kind and shape, for boxes that pick by their own shape (lib/art/frame). */
  art: ArtAsset[];
};

/** Portrait cover and wide art of a game read with GAME_ART_SELECT (https or same-site only). */
export function gameArtUrls(game: ArtRow): GameArtUrls {
  const media = (kind: string) => safeImageUrl(game.media.find((m) => m.kind === kind)?.url ?? null);
  return {
    coverUrl: media("cover") ?? safeImageUrl(game.coverUrl),
    heroUrl: media("hero") ?? safeImageUrl(game.heroUrl) ?? media("artwork") ?? media("screenshot"),
    steamAppId: game.steamAppId,
    art: artAssets({
      coverUrl: safeImageUrl(game.coverUrl),
      heroUrl: safeImageUrl(game.heroUrl),
      logoUrl: safeImageUrl(game.logoUrl ?? null),
      media: game.media.map((m) => ({ ...m, url: safeImageUrl(m.url) })),
    }),
  };
}
