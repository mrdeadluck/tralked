import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { gameRedirectPath } from "@/lib/catalog/redirects";
import { getGameTitle } from "@/lib/queries/games";
import { gameTag } from "@/lib/queries/games-cached";
import { gameIndexable, NOINDEX_FOLLOW, SITE_OPEN_GRAPH, SITE_SHARE_IMAGE } from "@/lib/seo/metadata";
import { shareImageUrl } from "@/lib/seo/share-image";

async function cachedGameTitle(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return getGameTitle(slug);
}

/**
 * Shared by the game and guide pages. Both are titled after the 100% achievement guide. Each game
 * gets its own description and share picture (its wide art, else the cover); name-only stubs and
 * pages without summary or achievements are kept out of the index (lib/seo/metadata gameIndexable).
 * `/guia` without a published guide points its canonical at the game page.
 */
export async function gameMetadata(slug: string, suffix = ""): Promise<Metadata> {
  const game = await cachedGameTitle(slug);
  if (!game) {
    const kept = await gameRedirectPath(slug, suffix);
    if (kept) permanentRedirect(kept);
    return { title: "Jogo não encontrado | Tralked" };
  }

  const gamePath = `/jogos/${slug}`;
  const guideOnly = suffix === "/guia";
  const title = game.hasGuide ? `Guia de conquistas 100%: ${game.name}` : `${game.name}: conquistas`;
  const description = game.hasGuide
    ? `Rota completa até o 100% em ${game.name}: conquistas detalhadas, coletáveis, tempo estimado e o seu progresso no Tralked.`
    : game.achievementCount > 0
      ? `As ${game.achievementCount} conquistas de ${game.name} com a raridade de cada uma, o tempo até o 100% e o seu progresso no Tralked.`
      : `${game.name} no Tralked: plataformas, tempo para zerar, conquistas e o seu progresso.`;
  const image = shareImageUrl({ heroUrl: game.heroUrl, imageUrl: game.coverUrl });
  const path = guideOnly && game.hasGuide ? `${gamePath}/guia` : gamePath;
  const indexable = gameIndexable(game) && (!guideOnly || game.hasGuide);

  return {
    title: `${title} | Tralked`,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      title,
      description,
      url: path,
      // A page's own openGraph drops the site's file-based picture: fall back to it by hand.
      images: [{ url: image ?? SITE_SHARE_IMAGE, alt: game.name }],
    },
    ...(image ? { twitter: { card: "summary_large_image", title, description, images: [image] } } : {}),
    ...(!indexable && { robots: NOINDEX_FOLLOW }),
  };
}
