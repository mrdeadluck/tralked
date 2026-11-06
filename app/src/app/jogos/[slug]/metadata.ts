import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { gameRedirectPath } from "@/lib/catalog/redirects";
import { getGameTitle } from "@/lib/queries/games";
import { gameTag } from "@/lib/queries/games-cached";

async function cachedGameTitle(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug));
  return getGameTitle(slug);
}

/** Shared by the game and guide pages. Both are titled after the 100% achievement guide. */
export async function gameMetadata(slug: string, suffix = ""): Promise<Metadata> {
  const game = await cachedGameTitle(slug);
  if (!game) {
    const kept = await gameRedirectPath(slug, suffix);
    if (kept) permanentRedirect(kept);
    return { title: "Jogo não encontrado | Tralked" };
  }

  return game.hasGuide
    ? {
        title: `Guia de conquistas 100%: ${game.name} | Tralked`,
        description: `Rota completa, conquistas detalhadas e coletáveis até o Tralked em ${game.name}.`,
      }
    : {
        title: `${game.name}: conquistas | Tralked`,
        description: `Acompanhe suas conquistas em ${game.name} e veja o guia da comunidade em produção.`,
      };
}
