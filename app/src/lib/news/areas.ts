import { normalizeTitle } from "@/lib/integrations/title-match";

/*
 * Areas of the external headline feeds (NewsFeed.area / ExternalNews.area) and the rule that
 * decides which headlines of a feed are kept. Pure: shared by the sync job, the admin form and
 * the news pages. Each area has the same id as the article category whose tab shows it.
 *
 * The rule, per area (titles only: feeds never give us more than title, link and date):
 * - GAMES: the title names a catalog game (name or alias, see sync/external-news.ts). Unchanged
 *   since Plan 2.
 * - ENTRETENIMENTO (anime, movies, series): only what relates to games. Kept only when the title
 *   has a gaming signal: a gaming term (`jogo`, `game`, `videogame`, `PlayStation`, `Steam Deck`,
 *   ...) or an unambiguous game franchise (`The Last of Us`, `Pokémon`, `Resident Evil`, ...).
 *   Known false friends (`Jogos Vorazes`, `Jogos Mortais`, `O Jogo da Imitação`, `Game of
 *   Thrones`, `Round 6`, `está em jogo`, ...) are removed from the title before searching.
 *   Names that are also ordinary words or people (`Steam`, `Fallout`, `Kirby`, `Halo`, `Control`,
 *   `Hades`, `Cyberpunk`, `Yakuza`, `Sonic`, `Arcane`, ...) are not signals: they only count when
 *   another gaming signal is in the same title ("Série de Fallout" alone is dropped; "Fallout
 *   ganha jogo novo" is kept). A catalog game name is never a signal on its own either (the film
 *   "Ready or Not 2" is not the game Ready or Not).
 * - TECNOLOGIA (hardware, PC, consoles, AI): everything the entertainment rule keeps, plus
 *   hardware and AI terms (`GPU`, `placa de vídeo`, `Ryzen`, `IA`, `inteligência artificial`,
 *   `ChatGPT`, ...).
 * In these two areas a headline is linked to a catalog game (and shows on its page) only when it
 * also has a gaming signal; one kept only by a hardware/AI term is never linked to a game.
 */

export const NEWS_FEED_AREAS = ["GAMES", "ENTRETENIMENTO", "TECNOLOGIA"] as const;
export type NewsFeedArea = (typeof NEWS_FEED_AREAS)[number];

export const NEWS_FEED_AREA_LABEL: Record<NewsFeedArea, string> = {
  GAMES: "Games",
  ENTRETENIMENTO: "Entretenimento",
  TECNOLOGIA: "Tecnologia",
};

/** What each area keeps, for the admin form. */
export const NEWS_FEED_AREA_HINT: Record<NewsFeedArea, string> = {
  GAMES: "Só manchetes que citam um jogo do catálogo; aparecem na página do jogo e no \"Em circulação\".",
  ENTRETENIMENTO:
    "Animes, filmes e séries: só manchetes com um sinal claro de games no título (termos como jogo/game ou franquias de games).",
  TECNOLOGIA: "Hardware, PC, consoles e IA: manchetes ligadas a games ou com termos de hardware e inteligência artificial.",
};

export const isNewsFeedArea = (value: unknown): value is NewsFeedArea =>
  typeof value === "string" && (NEWS_FEED_AREAS as readonly string[]).includes(value);

/** Unknown or legacy values read as GAMES. */
export const toNewsFeedArea = (value: unknown): NewsFeedArea => (isNewsFeedArea(value) ? value : "GAMES");

/** Phrases removed before searching (normalized): they look like games but are not. */
const FALSE_FRIENDS = [
  "hunger games",
  "jogos vorazes",
  "game of thrones",
  "squid game",
  "round 6",
  "jogos olimpicos",
  "olympic games",
  "jogos pan americanos",
  "game show",
  "game changer",
  "jogo do bicho",
  "jogo de cena",
  "jogo da velha",
  "jogos de azar",
  "jogo de futebol",
  "jogo do brasil",
  "jogos da copa",
  "jogo da selecao",
  // Films, series and idioms (pt-BR and English).
  "jogos mortais",
  "o jogo da imitacao",
  "jogo da imitacao",
  "the imitation game",
  "jogo perigoso",
  "jogo duplo",
  "jogo sujo",
  "jogo limpo",
  "jogo de poder",
  "jogos de poder",
  "jogo de cintura",
  // Only the idiom ("at stake"): "baseado em jogo" / "inspirado em jogo" are real signals.
  "o que esta em jogo",
  "o que estava em jogo",
  "esta em jogo",
  "estao em jogo",
  "estava em jogo",
  "colocar em jogo",
  "coloca em jogo",
  "por em jogo",
  "poe em jogo",
  "o jogo virou",
  "abrir o jogo",
  "fora de jogo",
  "jogo do amor",
  "molly s game",
  "game night",
  "game plan",
  "game day",
  "end game",
  "big game",
  "long game",
  "blame game",
  "waiting game",
  "numbers game",
  "mind games",
  "name of the game",
  "ahead of the game",
  "commonwealth games",
];

/** Gaming words and platforms (normalized, whole words). */
const GAMING_TERMS = [
  "game",
  "games",
  "videogame",
  "videogames",
  "video game",
  "video games",
  "jogo",
  "jogos",
  "gamer",
  "gamers",
  "gameplay",
  "esports",
  "e sports",
  "playstation",
  "ps5",
  "ps4",
  "xbox",
  "nintendo",
  "nintendo switch",
  "switch 2",
  "steam deck",
  "steam machine",
  "dlc",
  "speedrun",
];

/** Game franchises often adapted to anime, movies and series (normalized, whole words). */
const GAME_FRANCHISES = [
  "the last of us",
  "sonic the hedgehog",
  "league of legends",
  "super mario",
  "mario bros",
  "zelda",
  "pokemon",
  "pikachu",
  "street fighter",
  "mortal kombat",
  "resident evil",
  "silent hill",
  "tomb raider",
  "lara croft",
  "assassin s creed",
  "god of war",
  "minecraft",
  "fortnite",
  "final fantasy",
  "metal gear",
  "devil may cry",
  "castlevania",
  "borderlands",
  "five nights at freddy s",
  "fnaf",
  "death stranding",
  "kingdom hearts",
  "ghost of tsushima",
  "twisted metal",
  "gran turismo",
  "mega man",
  "pac man",
  "tetris",
  "donkey kong",
  "metroid",
  "warcraft",
  "starcraft",
  "overwatch",
  "hollow knight",
  "cuphead",
  "elden ring",
  "dark souls",
  "bloodborne",
  "like a dragon",
  "danganronpa",
  "tekken",
  "splinter cell",
  "bioshock",
  "half life",
  "angry birds",
  "until dawn",
  "horizon zero dawn",
  "red dead",
  "grand theft auto",
  "gta",
  "genshin impact",
  "honkai",
  "persona 3",
  "persona 4",
  "persona 5",
  "ace attorney",
  "monster hunter",
  "dragon quest",
  "king of fighters",
  "fatal fury",
  "guilty gear",
  "stardew valley",
  "among us",
  "watch dogs",
  "far cry",
  "rainbow six",
  "sekiro",
  "bayonetta",
  "nier",
  "valorant",
  "dota",
  "counter strike",
];

/** Hardware and AI terms (normalized, whole words). TECNOLOGIA only. */
const TECH_TERMS = [
  "gpu",
  "gpus",
  "placa de video",
  "placas de video",
  "graphics card",
  "graphics cards",
  "geforce",
  "rtx",
  "radeon",
  "nvidia",
  "amd",
  "ryzen",
  "intel",
  "processador",
  "processadores",
  "cpu",
  "cpus",
  "dlss",
  "fsr",
  "ray tracing",
  "directx",
  "vulkan",
  "unreal engine",
  "pc gamer",
  "gaming pc",
  "notebook gamer",
  "gaming laptop",
  "monitor gamer",
  "gaming monitor",
  "headset",
  "console",
  "consoles",
  "handheld",
  "rog ally",
  "legion go",
  "realidade virtual",
  "virtual reality",
  "meta quest",
  "ssd",
  "memoria ram",
  "overclock",
  "benchmark",
  "semicondutor",
  "semicondutores",
  "chip",
  "chips",
  "tsmc",
  "snapdragon",
  "inteligencia artificial",
  "artificial intelligence",
  "openai",
  "chatgpt",
  "gpt",
  "gemini",
  "anthropic",
  "copilot",
  "llm",
  "llms",
  "deepseek",
  "midjourney",
  "machine learning",
  "aprendizado de maquina",
  "deepfake",
  "deepfakes",
];

/** Short acronyms that are ordinary words in lowercase ("ia" = "went", "ai" = "ouch"): exact case only. */
const TECH_ACRONYMS = ["IA", "IAs", "AI", "AIs", "VR", "PC"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Normalized title padded with spaces, false friends removed. */
function prepare(title: string): string {
  let text = ` ${normalizeTitle(title)} `;
  for (const phrase of FALSE_FRIENDS) text = text.split(` ${phrase} `).join("  ");
  return text;
}

const hasAny = (prepared: string, terms: string[]) => terms.some((t) => prepared.includes(` ${t} `));

const ACRONYM = new RegExp(`(^|[^A-Za-z0-9])(${TECH_ACRONYMS.map(escape).join("|")})([^A-Za-z0-9]|$)`);

/** The title talks about games: a gaming term or a game franchise (false friends excluded). */
export function mentionsGaming(title: string): boolean {
  const text = prepare(title);
  return hasAny(text, GAMING_TERMS) || hasAny(text, GAME_FRANCHISES);
}

/** The title talks about hardware or AI. */
export function mentionsTech(title: string): boolean {
  return hasAny(prepare(title), TECH_TERMS) || ACRONYM.test(title);
}

/** A catalog game found in a headline title by the name matcher of the sync job. */
export type CatalogMatch = { gameId: string };

/**
 * Whether a feed headline is kept, and the game it is linked to (see the rule at the top).
 * Returns null when the headline does not belong to the area. Outside GAMES, the catalog match is
 * used only to link a headline that already has a gaming signal: a name alone ("Ready or Not",
 * "Control", "Hades") neither keeps nor links it.
 */
export function classifyHeadline(
  area: NewsFeedArea,
  title: string,
  match: CatalogMatch | null,
): { gameId: string | null } | null {
  if (area === "GAMES") return match ? { gameId: match.gameId } : null;
  if (mentionsGaming(title)) return { gameId: match?.gameId ?? null };
  if (area === "TECNOLOGIA" && mentionsTech(title)) return { gameId: null };
  return null;
}
