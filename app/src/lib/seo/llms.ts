import { prisma } from "@/lib/db";

/*
 * /llms.txt (llmstxt.org): a plain Markdown map of the site for AI answer engines (ChatGPT search,
 * Perplexity, Claude, Gemini) that read a page to cite it to a person. Training crawlers are
 * still blocked (lib/seo/ai-crawlers.ts); this only helps the ones that send readers back.
 */

export type LlmsData = {
  guides: { name: string; slug: string }[];
  articles: { title: string; slug: string; excerpt: string | null }[];
};

const LATEST_ARTICLES = 30;

export async function loadLlmsData(): Promise<LlmsData> {
  const [guides, articles] = await Promise.all([
    prisma.guide.findMany({
      where: { status: "published" },
      select: { game: { select: { name: true, slug: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.article.findMany({
      where: { status: "published" },
      select: { title: true, slug: true, excerpt: true },
      orderBy: { publishedAt: "desc" },
      take: LATEST_ARTICLES,
    }),
  ]);
  return { guides: guides.map((g) => g.game), articles };
}

/** One line of Markdown: no line breaks, brackets that could close the link text escaped. */
const inline = (text: string) => text.replace(/\s+/g, " ").replace(/([[\]])/g, "\\$1").trim();

/** Pure: the llms.txt body for `base` (the public origin). */
export function buildLlmsTxt(data: LlmsData, base: string): string {
  const url = (path: string) => new URL(path, base).toString();
  const link = (title: string, path: string, note?: string | null) =>
    `- [${inline(title)}](${url(path)})${note ? `: ${inline(note)}` : ""}`;

  return [
    "# Tralked",
    "",
    "> Gaming Hub em português do Brasil: notícias de games, guias de conquistas e troféus até o 100%, catálogo de jogos com a raridade de cada conquista, e uma ficha de personagem que transforma as conquistas da Steam, PlayStation, Xbox e RetroAchievements em XP, nível e habilidades.",
    "",
    "Todo o conteúdo é em português (pt-BR). As páginas de jogo mostram as conquistas, a porcentagem de jogadores que tem cada uma, plataformas e tempo até o 100%. Os guias trazem a rota completa, conquistas perdíveis e coletáveis.",
    "",
    "## Seções",
    "",
    link("Notícias", "/noticias", "notícias de games, atualizadas várias vezes por dia"),
    link("Jogos", "/jogos", "catálogo com conquistas, raridade e guias 100%"),
    link("Lançamentos", "/lancamentos", "próximos lançamentos por plataforma"),
    link("Calendário", "/calendario", "matérias e lançamentos do mês"),
    link("Fórum", "/forum", "dúvidas de conquistas e conversa sobre jogos"),
    link("Ranking", "/highscores", "ranking de jogadores por nível, conquistas e plataforma"),
    link("Como funciona o XP", "/como-funciona", "como as conquistas viram XP, nível e habilidades"),
    "",
    ...(data.guides.length > 0
      ? ["## Guias de conquistas 100%", "", ...data.guides.map((g) => link(`Guia 100%: ${g.name}`, `/jogos/${g.slug}/guia`)), ""]
      : []),
    ...(data.articles.length > 0
      ? ["## Notícias recentes", "", ...data.articles.map((a) => link(a.title, `/noticias/${a.slug}`, a.excerpt)), ""]
      : []),
    "## Opcional",
    "",
    link("Sitemap", "/sitemap.xml", "todas as páginas indexáveis"),
    link("Privacidade", "/privacidade"),
    link("Termos de uso", "/termos"),
    "",
  ].join("\n");
}
