/**
 * Options of the "Jogos" menu (header disclosure and the mobile drawer): the catalog filtered by
 * platform, Steam / PC first. The values are the catalog's `plataforma` filters.
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

/** A link of a header menu: label, one line of hint, and the sections it marks as current. */
export type MenuLink = {
  href: string;
  label: string;
  hint: string;
  /** Path prefixes that make this link (and its menu) the current section. */
  match?: string[];
};

/** "Jogos": the catalog and the ways into it (releases, calendar, 100% guides). */
export const GAMES_LINKS: MenuLink[] = [
  { href: "/jogos", label: "Catálogo", hint: "Todos os jogos com conquistas", match: ["/jogos"] },
  { href: "/lancamentos", label: "Lançamentos", hint: "O que saiu e o que vem aí", match: ["/lancamentos"] },
  { href: "/calendario", label: "Calendário", hint: "Datas de lançamento mês a mês", match: ["/calendario"] },
  { href: "/jogos?guia=1", label: "Guias 100%", hint: "Jogos com guia completo de conquistas" },
];

/** "Comunidade": where players talk, show and group up. */
export const COMMUNITY_LINKS: MenuLink[] = [
  { href: "/forum", label: "Fórum", hint: "Dúvidas, dicas e grupos", match: ["/forum"] },
  { href: "/galeria", label: "Galeria", hint: "Capturas de tela da comunidade", match: ["/galeria"] },
  { href: "/familia", label: "Família", hint: "Bibliotecas de quem joga com você", match: ["/familia"] },
];

/** True when `pathname` is `prefix` or a page under it. */
export function underPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function menuIsCurrent(pathname: string, links: MenuLink[]): boolean {
  return links.some((link) => link.match?.some((prefix) => underPath(pathname, prefix)));
}
