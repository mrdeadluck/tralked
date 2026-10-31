import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { getGameTitle } from "@/lib/queries/games";

async function cachedGameTitle(slug: string) {
  "use cache";
  cacheLife("minutes");
  return getGameTitle(slug);
}

/** Shared by the game and guide pages. Both are titled after the 100% achievement guide. */
export async function gameMetadata(slug: string): Promise<Metadata> {
  const game = await cachedGameTitle(slug);
  if (!game) return { title: "Jogo não encontrado | GAMELOG" };

  return game.hasGuide
    ? {
        title: `Guia de conquistas 100%: ${game.name} | GAMELOG`,
        description: `Rota completa, conquistas detalhadas e coletáveis para platinar ${game.name}.`,
      }
    : {
        title: `${game.name}: conquistas | GAMELOG`,
        description: `Acompanhe suas conquistas em ${game.name} e veja o guia da comunidade em produção.`,
      };
}
