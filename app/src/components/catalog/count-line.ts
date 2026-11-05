const FAMILY_NAME: Record<string, string> = { PC: "PC", PLAYSTATION: "PlayStation", XBOX: "Xbox", NINTENDO: "Nintendo", RETRO: "Retro" };

type CountLine = {
  total: number;
  /** Catalog platform filter in effect (PC, PLAYSTATION, ...). */
  platform?: string;
  /** "Só exclusivos" in effect (never with Retro). */
  exclusive: boolean;
  /** "Só com troféus" in effect (never with Nintendo). */
  withTrophies: boolean;
  /** The name search. */
  q?: string;
};

/** "1.102 jogos · exclusivos de PlayStation · com troféus": the results and the cuts that make them. */
export function countLine({ total, platform, exclusive, withTrophies, q }: CountLine): string {
  const family = platform ? (FAMILY_NAME[platform] ?? platform) : null;
  return [
    `${total.toLocaleString("pt-BR")} ${total === 1 ? "jogo" : "jogos"}`,
    exclusive ? (family ? `exclusivos de ${family}` : "exclusivos de uma plataforma só") : family,
    withTrophies ? "com troféus" : null,
    q ? `para “${q}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The toggles that take effect: exclusives never count on Retro (it is outside the exclusivity) and
 * trophies are not a thing on Nintendo. The params stay in the links either way.
 */
export function effectiveCuts(platform: string | undefined, exclusiveParam: boolean, trophiesParam: boolean) {
  return { exclusive: exclusiveParam && platform !== "RETRO", withTrophies: trophiesParam && platform !== "NINTENDO" };
}
