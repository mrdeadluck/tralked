/**
 * Options of the "Jogos" menu (header mega-menu and the mobile drawer's sub-list): the catalog
 * filtered by platform, Steam / PC first. The values are the catalog's `plataforma` filters.
 */
export type GameMenuOption = { href: string; label: string; hint: string; color: string };

export const GAME_MENU_OPTIONS: GameMenuOption[] = [
  { href: "/jogos?plataforma=PC", label: "Steam / PC", hint: "Biblioteca da Steam e jogos de PC", color: "var(--pc)" },
  { href: "/jogos?plataforma=PLAYSTATION", label: "PlayStation", hint: "PS5, PS4 e troféus da PSN", color: "var(--ps)" },
  { href: "/jogos?plataforma=XBOX", label: "Xbox", hint: "Series X|S, One e conquistas Xbox", color: "var(--xbox)" },
  { href: "/jogos?plataforma=NINTENDO", label: "Nintendo", hint: "Switch e portáteis", color: "var(--nin)" },
  { href: "/jogos?plataforma=RETRO", label: "Retro", hint: "Clássicos com RetroAchievements", color: "var(--r-epico)" },
];

export const GAME_MENU_ALL = { href: "/jogos", label: "Todos os jogos" } as const;
