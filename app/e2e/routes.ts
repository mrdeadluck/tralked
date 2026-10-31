export type E2ERoute = {
  path: string;
  /** Unique, file-name safe: used for screenshot names. */
  name: string;
  /** Needs a logged-in session (demo login), so it only runs in dev mode. */
  auth?: boolean;
};

/**
 * Central list of routes validated by smoke, screenshots and axe.
 * Every task that adds a page appends its routes here.
 */
export const ROUTES: E2ERoute[] = [
  { path: "/", name: "home" },
  { path: "/jogos", name: "jogos" },
  { path: "/jogos/hollow-knight", name: "jogo" },
  { path: "/jogos/hollow-knight/guia", name: "jogo-guia" },
  { path: "/noticias/25-conquistas-mais-raras-da-steam-em-2026", name: "noticia" },
  { path: "/highscores", name: "highscores" },
  { path: "/familia", name: "familia" },
  { path: "/jogador/lucas", name: "jogador" },
  { path: "/familia", name: "familia-logado", auth: true },
];
