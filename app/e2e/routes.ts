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
  { path: "/jogos/celeste", name: "jogo-sem-guia" },
  { path: "/jogos/hollow-knight", name: "jogo-logado", auth: true },
  { path: "/noticias", name: "noticias" },
  { path: "/noticias?categoria=guias&pagina=1", name: "noticias-guias" },
  { path: "/noticias?pagina=2", name: "noticias-pagina-2" },
  { path: "/noticias/25-conquistas-mais-raras-da-steam-em-2026", name: "noticia" },
  { path: "/noticias/hollow-knight-guia-100-por-cento-em-7-etapas", name: "noticia-jogo" },
  { path: "/highscores", name: "highscores" },
  { path: "/familia", name: "familia" },
  { path: "/jogador/lucas", name: "jogador" },
  { path: "/familia", name: "familia-logado", auth: true },
  { path: "/galeria", name: "galeria" },
  { path: "/galeria?jogo=hollow-knight", name: "galeria-jogo" },
  { path: "/galeria/seed-photo-01", name: "galeria-foto" },
  { path: "/forum", name: "forum" },
  { path: "/forum/ajuda", name: "forum-secao" },
  { path: "/forum/hollow-knight", name: "forum-jogo" },
  { path: "/forum/t/seed-thread-2", name: "forum-topico" },
  { path: "/galeria", name: "galeria-logado", auth: true },
  { path: "/galeria/seed-photo-01", name: "galeria-foto-logado", auth: true },
  { path: "/forum/t/seed-thread-3", name: "forum-topico-logado", auth: true },
  { path: "/conta", name: "conta" },
  { path: "/conta/conexoes", name: "conta-conexoes" },
  { path: "/conta", name: "conta-logado", auth: true },
  { path: "/conta/conexoes", name: "conta-conexoes-logado", auth: true },
  { path: "/jogador/lucas", name: "jogador-logado", auth: true },
  { path: "/desenvolvedores", name: "desenvolvedores" },
];
