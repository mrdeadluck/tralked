import ownedGames from "../../src/lib/integrations/steam/__fixtures__/owned-games.json";
import type { SkillId } from "../../src/lib/engine/types";

type Platform = "PC" | "PLAYSTATION" | "XBOX" | "NINTENDO";

export type SeedGame = {
  slug: string;
  name: string;
  steamAppId: number;
  skills: SkillId[];
  /** Achievement totals from the preview (`GAMES[].total` / `done`). */
  achievementCount: number;
  lucasUnlocked: number;
  lucasPlaytimeMin: number;
  platforms: Platform[];
  summary: string;
};

type GameBase = Omit<SeedGame, "steamAppId" | "lucasPlaytimeMin"> & {
  /** Must match an entry of the Steam fixture `owned-games.json`. */
  steamAppId: number;
};

const BASE: GameBase[] = [
  {
    slug: "hollow-knight",
    name: "Hollow Knight",
    steamAppId: 367520,
    skills: ["soulslike", "plataforma"],
    achievementCount: 63,
    lucasUnlocked: 58,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Metroidvania de exploração densa em um reino subterrâneo, com chefes exigentes e muitos coletáveis.",
  },
  {
    slug: "hades",
    name: "Hades",
    steamAppId: 1145360,
    skills: ["roguelike", "rpg"],
    achievementCount: 49,
    lucasUnlocked: 46,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Roguelike de ação em que cada fuga do submundo muda com as bênçãos e armas escolhidas.",
  },
  {
    slug: "resident-evil-4",
    name: "Resident Evil 4",
    steamAppId: 2050650,
    skills: ["horror", "fps"],
    achievementCount: 44,
    lucasUnlocked: 40,
    platforms: ["PC", "PLAYSTATION", "XBOX"],
    summary:
      "Survival horror de ação em terceira pessoa, com gestão de munição e chefes marcantes.",
  },
  {
    slug: "elden-ring",
    name: "Elden Ring",
    steamAppId: 1245620,
    skills: ["soulslike", "rpg"],
    achievementCount: 42,
    lucasUnlocked: 31,
    platforms: ["PC", "PLAYSTATION", "XBOX"],
    summary:
      "RPG de ação em mundo aberto, com combate exigente, builds variadas e chefes opcionais.",
  },
  {
    slug: "portal-2",
    name: "Portal 2",
    steamAppId: 620,
    skills: ["puzzle", "coop"],
    achievementCount: 51,
    lucasUnlocked: 51,
    platforms: ["PC"],
    summary:
      "Quebra-cabeças em primeira pessoa baseado em portais, com campanha solo e modo cooperativo.",
  },
  {
    slug: "slay-the-spire",
    name: "Slay the Spire",
    steamAppId: 646570,
    skills: ["roguelike", "estrategia"],
    achievementCount: 46,
    lucasUnlocked: 46,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Jogo de cartas roguelike: monte um baralho a cada partida e suba a torre.",
  },
  {
    slug: "left-4-dead-2",
    name: "Left 4 Dead 2",
    steamAppId: 550,
    skills: ["fps", "coop", "horror"],
    achievementCount: 100,
    lucasUnlocked: 71,
    platforms: ["PC"],
    summary:
      "Tiro cooperativo contra hordas de infectados, com campanhas jogadas em grupo de quatro.",
  },
  {
    slug: "doom-eternal",
    name: "DOOM Eternal",
    steamAppId: 782330,
    skills: ["fps"],
    achievementCount: 40,
    lucasUnlocked: 22,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Tiro em primeira pessoa de ritmo acelerado, que recompensa movimentação agressiva.",
  },
  {
    slug: "dead-space",
    name: "Dead Space",
    steamAppId: 1693980,
    skills: ["horror"],
    achievementCount: 50,
    lucasUnlocked: 9,
    platforms: ["PC", "PLAYSTATION", "XBOX"],
    summary:
      "Survival horror de ficção científica a bordo de uma nave isolada, com desmembramento estratégico.",
  },
  {
    slug: "baldurs-gate-3",
    name: "Baldur's Gate 3",
    steamAppId: 1086940,
    skills: ["rpg", "estrategia"],
    achievementCount: 54,
    lucasUnlocked: 30,
    platforms: ["PC", "PLAYSTATION", "XBOX"],
    summary:
      "RPG por turnos com campanha ramificada, em que as escolhas mudam o rumo da história.",
  },
  {
    slug: "celeste",
    name: "Celeste",
    steamAppId: 504230,
    skills: ["plataforma"],
    achievementCount: 32,
    lucasUnlocked: 12,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Plataforma de precisão sobre escalar uma montanha, com capítulos extras para quem quer desafio.",
  },
  {
    slug: "stardew-valley",
    name: "Stardew Valley",
    steamAppId: 413150,
    skills: ["simulacao", "rpg"],
    achievementCount: 40,
    lucasUnlocked: 25,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Simulador de vida no campo: plante, crie animais, explore minas e faça amizades na vila.",
  },
  {
    slug: "civilization-vi",
    name: "Civilization VI",
    steamAppId: 289070,
    skills: ["estrategia"],
    achievementCount: 320,
    lucasUnlocked: 64,
    platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
    summary:
      "Estratégia por turnos em que você conduz uma civilização da Antiguidade até a era moderna.",
  },
  {
    slug: "phasmophobia",
    name: "Phasmophobia",
    steamAppId: 739630,
    skills: ["horror", "coop"],
    achievementCount: 40,
    lucasUnlocked: 18,
    platforms: ["PC"],
    summary:
      "Terror cooperativo de investigação paranormal, com equipamentos e comunicação por voz.",
  },
];

/** The 14 preview games. Playtime comes from the Steam fixture so both agree. */
export const GAMES: SeedGame[] = BASE.map((game) => {
  const owned = ownedGames.find((g) => g.appId === game.steamAppId);
  if (!owned) throw new Error(`Missing owned-games fixture for ${game.slug}`);
  return { ...game, lucasPlaytimeMin: owned.playtimeMin };
});

export const GAME_SLUG_BY_PREVIEW_ID: Record<string, string> = {
  "hollow-knight": "hollow-knight",
  hades: "hades",
  re4: "resident-evil-4",
  "elden-ring": "elden-ring",
  "portal-2": "portal-2",
  "slay-the-spire": "slay-the-spire",
  l4d2: "left-4-dead-2",
  "doom-eternal": "doom-eternal",
  "dead-space": "dead-space",
  bg3: "baldurs-gate-3",
  celeste: "celeste",
  stardew: "stardew-valley",
  civ6: "civilization-vi",
  phasmophobia: "phasmophobia",
};

/** Extra achievements shown in lucas's recent feed in the preview (`S.feed`). */
export const FEED_ACHIEVEMENTS: {
  gameSlug: string;
  apiName: string;
  name: string;
  globalPct: number;
  /** How long before the seed run the unlock happened. */
  agoHours: number;
}[] = [
  { gameSlug: "hades", apiName: "HELLBENT", name: "Hellbent", globalPct: 4.8, agoHours: 28 },
  { gameSlug: "resident-evil-4", apiName: "MERCENARIO_S_PLUS", name: "Mercenário S+", globalPct: 7.9, agoHours: 30 },
  { gameSlug: "slay-the-spire", apiName: "ASCENSAO_20", name: "Ascensão 20", globalPct: 1.6, agoHours: 72 },
];
