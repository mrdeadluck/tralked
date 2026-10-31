/**
 * Community and editorial example data for the development seed: external headlines, forum,
 * gallery, comments, reports, notifications and an example bot key. All text, links and
 * publications are fictional (example.com / example.org).
 *
 * Rows without a natural key use fixed `seed-…` ids, so the seed upserts them idempotently.
 */

/** Example RSS feeds (inactive: the URLs are placeholders). */
export const NEWS_FEEDS = [
  { name: "Portal Exemplo", url: "https://example.com/feeds/jogos.xml" },
  { name: "Revista Fictícia", url: "https://example.org/rss/games" },
];

/** Six external headlines about Hollow Knight (only title, link, source and date are stored). */
export const HK_EXTERNAL_NEWS: { title: string; url: string; source: string; agoHours: number }[] = [
  { title: "Hollow Knight: comunidade monta mapa interativo de todos os coletáveis", url: "https://example.com/noticias/hollow-knight-mapa-coletaveis", source: "Portal Exemplo", agoHours: 5 },
  { title: "Speedrunners de Hollow Knight batem novo recorde na categoria 100%", url: "https://example.org/games/hollow-knight-recorde-100", source: "Revista Fictícia", agoHours: 20 },
  { title: "Os chefes mais difíceis de Hollow Knight, segundo os leitores", url: "https://example.com/noticias/hollow-knight-chefes-dificeis", source: "Portal Exemplo", agoHours: 46 },
  { title: "Hollow Knight ganha edição física comemorativa (exemplo)", url: "https://example.org/games/hollow-knight-edicao-fisica", source: "Revista Fictícia", agoHours: 70 },
  { title: "Guia rápido: como chegar ao Panteão de Hallownest", url: "https://example.com/noticias/hollow-knight-panteao-guia", source: "Portal Exemplo", agoHours: 96 },
  { title: "Trilha sonora de Hollow Knight volta às plataformas de streaming", url: "https://example.org/games/hollow-knight-trilha-sonora", source: "Revista Fictícia", agoHours: 150 },
];

export const FORUM_CATEGORIES = [
  { slug: "geral", name: "Geral", description: "Conversa sobre jogos, conquistas e o que você está jogando.", order: 0 },
  { slug: "ajuda", name: "Ajuda e conquistas", description: "Dúvidas sobre conquistas, troféus e rotas de 100%.", order: 1 },
  { slug: "tralked", name: "Sobre o Tralked", description: "Sugestões, bugs e novidades do site.", order: 2 },
];

export type SeedThread = {
  id: string;
  categorySlug: string | null;
  gameSlug: string | null;
  authorHandle: string;
  title: string;
  slug: string;
  pinned: boolean;
  agoHours: number;
  posts: { id: string; authorHandle: string; body: string; agoHours: number }[];
  /** Id of the post marked "Resolveu". */
  solvedPostId?: string;
};

export const FORUM_THREADS: SeedThread[] = [
  {
    id: "seed-thread-1", categorySlug: "tralked", gameSlug: null, authorHandle: "lucas", pinned: true, agoHours: 400,
    title: "Boas-vindas ao fórum (leia antes de postar)", slug: "boas-vindas-ao-forum",
    posts: [
      { id: "seed-post-1-1", authorHandle: "lucas", agoHours: 400, body: "Este é um tópico de exemplo do ambiente de desenvolvimento. Seja gentil, marque spoilers e use o tópico do jogo para dúvidas específicas." },
    ],
  },
  {
    id: "seed-thread-2", categorySlug: "ajuda", gameSlug: "hollow-knight", authorHandle: "Escudeiro_Tadeu", pinned: false, agoHours: 30,
    title: "Ritual ou Banishment primeiro?", slug: "ritual-ou-banishment-primeiro",
    posts: [
      { id: "seed-post-2-1", authorHandle: "Escudeiro_Tadeu", agoHours: 30, body: "Quero fazer as duas conquistas da Trupe Grimm. Qual faço no save principal?" },
      { id: "seed-post-2-2", authorHandle: "Escriba_Odete", agoHours: 28, body: "Faça Ritual no save principal e deixe Banishment para um save separado, como o guia indica na etapa 4." },
      { id: "seed-post-2-3", authorHandle: "Escudeiro_Tadeu", agoHours: 26, body: "Funcionou, obrigado!" },
    ],
    solvedPostId: "seed-post-2-2",
  },
  {
    id: "seed-thread-3", categorySlug: null, gameSlug: "hollow-knight", authorHandle: "Cacador_Joaquim", pinned: false, agoHours: 12,
    title: "Dicas para o Panteão 5 sem dano", slug: "dicas-panteao-5-sem-dano",
    posts: [
      { id: "seed-post-3-1", authorHandle: "Cacador_Joaquim", agoHours: 12, body: "Alguém tem uma ordem de amuletos boa para o Panteão 5?" },
      { id: "seed-post-3-2", authorHandle: "Herbalista_Rosa", agoHours: 9, body: "Golpe Rápido, Marca do Orgulho e Coração Inquebrável funcionaram para mim." },
    ],
  },
  {
    id: "seed-thread-4", categorySlug: "geral", gameSlug: null, authorHandle: "Mercador_Anselmo", pinned: false, agoHours: 50,
    title: "Qual foi a sua primeira platina?", slug: "qual-foi-a-sua-primeira-platina",
    posts: [
      { id: "seed-post-4-1", authorHandle: "Mercador_Anselmo", agoHours: 50, body: "A minha foi num jogo de plataforma. E a de vocês?" },
      { id: "seed-post-4-2", authorHandle: "Lenhador_Bento", agoHours: 47, body: "Um jogo de corrida, há muitos anos." },
      { id: "seed-post-4-3", authorHandle: "lucas", agoHours: 40, body: "Hollow Knight no PS4, depois de muitas tentativas no Panteão." },
    ],
  },
  {
    id: "seed-thread-5", categorySlug: "ajuda", gameSlug: "hades", authorHandle: "Barqueiro_Tobias", pinned: false, agoHours: 70,
    title: "Vale fazer todas as profecias antes do final verdadeiro?", slug: "profecias-antes-do-final",
    posts: [
      { id: "seed-post-5-1", authorHandle: "Barqueiro_Tobias", agoHours: 70, body: "Estou na décima fuga. Faço as profecias agora ou depois?" },
      { id: "seed-post-5-2", authorHandle: "Alquimista_Damiao", agoHours: 66, body: "Depois. Muitas saem naturalmente enquanto você avança na história." },
    ],
  },
  {
    id: "seed-thread-6", categorySlug: "geral", gameSlug: "resident-evil-4", authorHandle: "Taverneira_Gerta", pinned: false, agoHours: 100,
    title: "Melhor arma para a faca sem upgrades", slug: "melhor-arma-faca-sem-upgrades",
    posts: [
      { id: "seed-post-6-1", authorHandle: "Taverneira_Gerta", agoHours: 100, body: "Tópico de exemplo: qual arma vocês usam para a conquista de faca sem melhorias?" },
    ],
  },
];

/** Gallery photos: `url` null = generated art in the UI. */
export const PHOTOS: {
  id: string;
  authorHandle: string;
  gameSlug: string;
  caption: string;
  width: number;
  height: number;
  agoHours: number;
  likedBy: string[];
}[] = [
  { id: "seed-photo-01", authorHandle: "lucas", gameSlug: "hollow-knight", caption: "Chegando em Hallownest pela primeira vez.", width: 1920, height: 1080, agoHours: 3, likedBy: ["Cacador_Joaquim", "Herbalista_Rosa", "Escudeiro_Tadeu", "Lenhador_Bento"] },
  { id: "seed-photo-02", authorHandle: "Cacador_Joaquim", gameSlug: "elden-ring", caption: "Pôr do sol nas Terras Intermédias.", width: 1920, height: 1080, agoHours: 8, likedBy: ["lucas", "Herbalista_Rosa"] },
  { id: "seed-photo-03", authorHandle: "Herbalista_Rosa", gameSlug: "celeste", caption: "Topo da montanha, finalmente.", width: 1080, height: 1350, agoHours: 15, likedBy: ["lucas"] },
  { id: "seed-photo-04", authorHandle: "Escudeiro_Tadeu", gameSlug: "hades", caption: "Primeira fuga completa.", width: 1920, height: 1080, agoHours: 22, likedBy: ["Barqueiro_Tobias", "Alquimista_Damiao", "lucas"] },
  { id: "seed-photo-05", authorHandle: "Mercador_Anselmo", gameSlug: "doom-eternal", caption: "Arena final, sem dano.", width: 1920, height: 1080, agoHours: 30, likedBy: [] },
  { id: "seed-photo-06", authorHandle: "Lenhador_Bento", gameSlug: "stardew-valley", caption: "A fazenda depois de três anos.", width: 1080, height: 1080, agoHours: 41, likedBy: ["lucas", "Taverneira_Gerta"] },
  { id: "seed-photo-07", authorHandle: "Escriba_Odete", gameSlug: "hollow-knight", caption: "O Palácio Branco em silêncio.", width: 1920, height: 1080, agoHours: 55, likedBy: ["lucas", "Cacador_Joaquim", "Guardia_Selene"] },
  { id: "seed-photo-08", authorHandle: "Guardia_Selene", gameSlug: "baldurs-gate-3", caption: "Grupo reunido antes do ato 3.", width: 1920, height: 1080, agoHours: 70, likedBy: ["Lenhador_Bento"] },
  { id: "seed-photo-09", authorHandle: "Barqueiro_Tobias", gameSlug: "portal-2", caption: "Teste cooperativo resolvido.", width: 1920, height: 1080, agoHours: 90, likedBy: [] },
  { id: "seed-photo-10", authorHandle: "Alquimista_Damiao", gameSlug: "slay-the-spire", caption: "Ascensão 20 vencida.", width: 1080, height: 1350, agoHours: 120, likedBy: ["Barqueiro_Tobias"] },
  { id: "seed-photo-11", authorHandle: "Taverneira_Gerta", gameSlug: "dead-space", caption: "Corredor da Ishimura.", width: 1920, height: 1080, agoHours: 150, likedBy: ["Mercador_Anselmo", "lucas"] },
  { id: "seed-photo-12", authorHandle: "Ferreiro_Bastiao", gameSlug: "resident-evil-4", caption: "A vila, de novo.", width: 1920, height: 1080, agoHours: 200, likedBy: [] },
];

/** Comments; `target` is resolved by the seed (article slug, the HK guide or a photo id). */
export const COMMENTS: {
  id: string;
  authorHandle: string;
  target: { type: "article"; slug: string } | { type: "guide"; gameSlug: string } | { type: "photo"; id: string };
  body: string;
  agoHours: number;
  status?: "visible" | "hidden" | "removed";
}[] = [
  { id: "seed-comment-01", authorHandle: "Escudeiro_Tadeu", target: { type: "article", slug: "25-conquistas-mais-raras-da-steam-em-2026" }, body: "Ótima lista. Já tenho três delas!", agoHours: 1 },
  { id: "seed-comment-02", authorHandle: "Cacador_Joaquim", target: { type: "article", slug: "25-conquistas-mais-raras-da-steam-em-2026" }, body: "Faltou falar do tempo de grind de algumas.", agoHours: 1.5 },
  { id: "seed-comment-03", authorHandle: "Herbalista_Rosa", target: { type: "article", slug: "hollow-knight-guia-100-por-cento-em-7-etapas" }, body: "A nova ordem das etapas ficou bem melhor.", agoHours: 6 },
  { id: "seed-comment-04", authorHandle: "Lenhador_Bento", target: { type: "guide", gameSlug: "hollow-knight" }, body: "Seguindo a rota, estou na etapa 3.", agoHours: 10 },
  { id: "seed-comment-05", authorHandle: "Escriba_Odete", target: { type: "guide", gameSlug: "hollow-knight" }, body: "Atualizei a nota sobre o Panteão, confiram.", agoHours: 4 },
  { id: "seed-comment-06", authorHandle: "Cacador_Joaquim", target: { type: "photo", id: "seed-photo-01" }, body: "Que nostalgia!", agoHours: 2 },
  { id: "seed-comment-07", authorHandle: "lucas", target: { type: "photo", id: "seed-photo-02" }, body: "Essa luz ficou linda.", agoHours: 7 },
  { id: "seed-comment-08", authorHandle: "Barqueiro_Tobias", target: { type: "photo", id: "seed-photo-04" }, body: "Parabéns pela fuga!", agoHours: 20 },
  { id: "seed-comment-09", authorHandle: "Ferreiro_Bastiao", target: { type: "article", slug: "25-conquistas-mais-raras-da-steam-em-2026" }, body: "Comentário de exemplo removido pela moderação.", agoHours: 0.5, status: "hidden" },
];

/** Example moderation queue entries. */
export const REPORTS: { id: string; reporterHandle: string; commentId: string; reason: string; agoHours: number }[] = [
  { id: "seed-report-1", reporterHandle: "Herbalista_Rosa", commentId: "seed-comment-09", reason: "Spam (exemplo).", agoHours: 0.4 },
];

export const LUCAS_NOTIFICATIONS: { id: string; kind: string; title: string; body?: string; href?: string; agoHours: number; read: boolean }[] = [
  { id: "seed-notif-1", kind: "photo_like", title: "Cacador_Joaquim curtiu sua foto", href: "/galeria", agoHours: 2, read: false },
  { id: "seed-notif-2", kind: "comment_reply", title: "Novo comentário na sua foto", body: "Que nostalgia!", href: "/galeria", agoHours: 2, read: false },
  { id: "seed-notif-3", kind: "level_up", title: "Você chegou ao nível 47", href: "/jogador/lucas", agoHours: 26, read: true },
  { id: "seed-notif-4", kind: "system", title: "Sua conta PSN foi verificada", href: "/conta", agoHours: 200, read: true },
];

/** Example bot key. Its secret is never stored: the hash is of a random, discarded value. */
export const EXAMPLE_API_KEY = {
  id: "seed-api-key-1",
  name: "Robô de exemplo (sem segredo utilizável)",
  prefix: "tk_live_exem",
  scopes: ["articles:write", "guides:write"],
};
