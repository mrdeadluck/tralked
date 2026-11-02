import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameArt } from "@/components/art/GameArt";
import { Comments } from "@/components/community/Comments";
import { ArticleModeration } from "@/components/moderation/Islands";
import { AdSlot } from "@/components/ui/AdSlot";
import { ArticleBody } from "@/components/news/ArticleBody";
import { ArticleTags } from "@/components/news/ArticleTags";
import { GameCoverThumb } from "@/components/news/GameCoverThumb";
import { Blocks } from "@/lib/content/render";
import { isSafeHttpUrl } from "@/lib/content/url";
import { JsonLd, newsArticleJsonLd } from "@/lib/seo/json-ld";
import {
  articleTag,
  artHues,
  getAllArticleSlugs,
  getArticle,
  hashSeed,
  NEWS_TAG,
  type ArticleFull,
} from "@/lib/queries/news";

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeZone: "America/Sao_Paulo",
});

async function loadArticle(slug: string): Promise<ArticleFull | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG, articleTag(slug));
  return getArticle(slug);
}

export async function generateStaticParams() {
  // The most recent articles (capped). Cache Components needs at least one sample: with no
  // articles the placeholder renders a real 404; other slugs render on demand.
  const slugs = await getAllArticleSlugs();
  return (slugs.length > 0 ? slugs : ["exemplo"]).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/noticias/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) return { title: "Notícia não encontrada | Tralked" };
  return {
    title: `${article.title} | Tralked`,
    description: article.excerpt ?? undefined,
    openGraph: {
      type: "article",
      title: article.title,
      description: article.excerpt ?? undefined,
      publishedTime: article.publishedAt.toISOString(),
    },
  };
}

const sectionTitle = "text-[22px] leading-none font-black font-stretch-[125%] tracking-[-0.03em] uppercase";

/** Plan 4 F12: links to a game related to the article (targets at least 24px tall). */
const gameLink =
  "inline-flex min-h-6 items-center font-mono text-xs tracking-[0.08em] text-acc uppercase underline-offset-[3px] hover:underline";

/**
 * "Jogo desta notícia" at the end: the catalog cover (generated art when the game has none, e.g.
 * a stub) and both ways out: the game page and, when there is one, the 100% guide.
 */
function RelatedGames({ article }: { article: ArticleFull }) {
  if (article.games.length === 0) return null;
  return (
    <section aria-labelledby="h-jogos" className="flex flex-col gap-4">
      <h2 id="h-jogos" className={sectionTitle}>
        {article.games.length > 1 ? "Jogos desta notícia" : "Jogo desta notícia"}
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
        {article.games.map((game) => (
          <li
            key={game.slug}
            className="flex items-center gap-4 rounded-[4px] border border-line bg-surface p-3 transition-colors hover:border-line-2"
          >
            <span className="block h-16 w-12 flex-none overflow-hidden rounded-[2px]">
              <GameCoverThumb
                coverUrl={game.coverUrl}
                variant="card"
                seed={hashSeed(game.slug)}
                hues={artHues(game.slug, game.slug)}
              />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <b className="truncate text-[17px] font-extrabold">{game.name}</b>
              <span className="flex flex-wrap gap-x-4">
                <Link href={`/jogos/${game.slug}`} aria-label={`Ver jogo: ${game.name}`} className={gameLink}>
                  Ver jogo →
                </Link>
                {game.hasGuide ? (
                  <Link href={`/jogos/${game.slug}/guia`} aria-label={`Abrir guia 100% de ${game.name}`} className={gameLink}>
                    Abrir guia 100% →
                  </Link>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Plan 4 F12: chips right under the headline, one per related game, with its catalog cover and
 * the links to the game page and the 100% guide. A game without a cover (stub), or whose cover
 * fails to load, shows only its name.
 */
function GameChips({ article }: { article: ArticleFull }) {
  if (article.games.length === 0) return null;
  return (
    <ul
      aria-label={article.games.length > 1 ? "Jogos desta notícia" : "Jogo desta notícia"}
      className="m-0 flex list-none flex-wrap gap-2 p-0"
    >
      {article.games.map((game) => (
        <li
          key={game.slug}
          className="flex min-h-11 items-center gap-2.5 rounded-[3px] border border-line bg-surface py-1 pr-3 pl-1"
        >
          <GameCoverThumb
            coverUrl={game.coverUrl}
            variant="chip"
            seed={hashSeed(game.slug)}
            hues={artHues(game.slug, game.slug)}
          />
          <span className="text-[14px] font-bold">{game.name}</span>
          <span className="flex gap-3 pl-1">
            <Link href={`/jogos/${game.slug}`} aria-label={`Ver jogo: ${game.name}`} className={gameLink}>
              Ver jogo
            </Link>
            {game.hasGuide ? (
              <Link href={`/jogos/${game.slug}/guia`} aria-label={`Guia 100% de ${game.name}`} className={gameLink}>
                Guia 100%
              </Link>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ExternalSources({ article }: { article: ArticleFull }) {
  // Feed URLs are untrusted: only absolute http(s) links are rendered (the query filters them too).
  const headlines = article.externalNews.filter((news) => isSafeHttpUrl(news.url));
  if (headlines.length === 0) return null;
  return (
    <section aria-labelledby="h-imprensa" className="flex flex-col gap-3">
      <h2 id="h-imprensa" className={sectionTitle}>
        Na imprensa
      </h2>
      <p className="text-[14px] text-muted">
        Manchetes de outros sites sobre {article.games.map((g) => g.name).join(", ")}. O Tralked guarda só
        o título, o link e a data; a matéria completa fica na fonte.
      </p>
      <ul className="m-0 list-none p-0">
        {headlines.map((news) => (
          <li key={news.id} className="border-b border-divider last:border-b-0">
            <a
              href={news.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-1 py-3"
            >
              <span className="text-[16px] leading-snug font-bold group-hover:text-acc">
                {news.title}
                <span className="sr-only"> (abre em nova aba)</span>
              </span>
              <span className="font-mono text-xs text-dim">
                Fonte externa: {news.source} · {DATE_FORMAT.format(news.publishedAt)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleLayout({ article }: { article: ArticleFull }) {
  return (
    <article className="mx-auto flex w-full max-w-[860px] flex-col gap-10">
      <header className="flex flex-col gap-4">
        <Link href="/noticias" className="self-start font-mono text-xs tracking-[0.08em] text-acc uppercase">
          ← Notícias
        </Link>
        <ArticleTags article={article} />
        <h1 className="text-[clamp(30px,4vw,48px)] leading-[1.02] font-black font-stretch-[112%] tracking-[-0.035em]">
          {article.title}
        </h1>
        {article.subtitle ? <p className="text-lg text-text-3">{article.subtitle}</p> : null}
        <GameChips article={article} />
        <div className="flex flex-wrap gap-3.5 font-mono text-xs text-dim">
          {/* Robot articles are signed "Equipe Tralked", not a user handle. */}
          <span className="text-text-2">{article.authorLabel}</span>
          <time dateTime={article.publishedAt.toISOString()}>{DATE_FORMAT.format(article.publishedAt)}</time>
          <span>▲ {article.likes}</span>
          <a href="#comentarios" className="hover:text-text">
            ◼ {article.comments} {article.comments === 1 ? "comentário" : "comentários"}
          </a>
          {article.source !== "bot" && article.humanAuthored ? (
            <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
              Autoria humana
            </span>
          ) : null}
        </div>
        {/* Session island: newsroom tools for admin/editor, "Denunciar" for everyone else. */}
        <ArticleModeration
          articleId={article.id}
          category={article.category}
          featured={article.featured}
          returnTo={`/noticias/${article.slug}`}
        />
      </header>

      <div className="aspect-[21/9] overflow-hidden rounded-[3px] bg-surface">
        <GameArt
          seed={hashSeed(article.slug)}
          hues={artHues(article.game?.slug, article.slug)}
          imageUrl={article.heroUrl}
          figure
          light
          width={1200}
          height={514}
        />
      </div>

      {article.blocks.length > 0 ? (
        <Blocks blocks={article.blocks} achievements={article.achievements} />
      ) : (
        <ArticleBody markdown={article.body} />
      )}

      <AdSlot format="leaderboard" />

      <RelatedGames article={article} />
      <ExternalSources article={article} />

      {/* Comments island (#comentarios): streams the comments and the visitor's session. */}
      <div className="border-t border-line pt-8">
        <Comments targetType="article" targetId={article.id} />
      </div>
    </article>
  );
}

export default async function NoticiaPage({ params }: PageProps<"/noticias/[slug]">) {
  // The article comes from cache, so an unknown slug is a real 404 before anything streams.
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) notFound();

  return (
    <>
      <JsonLd data={newsArticleJsonLd(article)} />
      <ArticleLayout article={article} />
    </>
  );
}
