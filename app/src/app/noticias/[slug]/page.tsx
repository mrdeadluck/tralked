import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FramedArt } from "@/components/art/FramedArt";
import { Comments } from "@/components/community/Comments";
import { ReactionBar } from "@/components/community/ReactionBar";
import { EyeIcon } from "@/components/community/reaction-icons";
import { ArticleViewBeacon } from "@/components/news/ArticleViewBeacon";
import { ArticleModeration } from "@/components/moderation/Islands";
import { AdSlot, adsEnabled } from "@/components/ui/AdSlot";
import { ArrowRightIcon } from "@/components/layout/icons";
import { ArticleBody } from "@/components/news/ArticleBody";
import { ArticleTags } from "@/components/news/ArticleTags";
import { GameCoverThumb } from "@/components/news/GameCoverThumb";
import { Newsletter } from "@/components/layout/Newsletter";
import { PlatformChips } from "@/components/ui/PlatformChips";
import { withHuntCallout } from "@/lib/news/hunt-callout";
import { Blocks } from "@/lib/content/render";
import { isSafeHttpUrl } from "@/lib/content/url";
import { JsonLd, newsArticleJsonLd } from "@/lib/seo/json-ld";
import {
  articleTag,
  artHues,
  getAllArticleSlugs,
  getArticle,
  getHomeRanking,
  getNextArticle,
  hashSeed,
  NEWS_TAG,
  type ArticleCard,
  type ArticleFull,
} from "@/lib/queries/news";

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeZone: "America/Sao_Paulo",
});

async function loadArticle(slug: string): Promise<ArticleFull | null> {
  "use cache";
  cacheLife("feed");
  cacheTag(NEWS_TAG, articleTag(slug));
  return getArticle(slug);
}

/**
 * The article's way out (cached): the next story and the most viewed ones (by reactions until
 * there are enough views), without this article or the next one.
 */
async function loadArticleEnd(id: string, publishedAtIso: string) {
  "use cache";
  cacheLife("feed");
  cacheTag(NEWS_TAG);
  const [next, ranking] = await Promise.all([
    getNextArticle({ id, publishedAt: new Date(publishedAtIso) }),
    getHomeRanking(8),
  ]);
  const most = ranking.articles.filter((a) => a.id !== id && a.id !== next?.id).slice(0, 4);
  return { next, most, mostTitle: ranking.title };
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

/** Plan 4 F12: links to a game related to the article (44px tall on phones, 24px from sm up). */
const gameLink =
  "inline-flex min-h-11 items-center font-mono text-xs tracking-[0.08em] text-acc uppercase underline-offset-[3px] hover:underline sm:min-h-6";

/**
 * "Jogo desta notícia" at the end: the game as a card of the catalog (case cover, full name,
 * platforms, what there is to hunt) with both ways out: the game page and the 100% guide. The
 * chip under the headline is the shortcut; this is where the reader who finished goes next.
 */
function RelatedGames({ article }: { article: ArticleFull }) {
  if (article.games.length === 0) return null;
  return (
    <section aria-labelledby="h-jogos" className="flex flex-col gap-4">
      <h2 id="h-jogos" className={sectionTitle}>
        {article.games.length > 1 ? "Jogos desta notícia" : "Jogo desta notícia"}
      </h2>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
        {article.games.map((game) => {
          const count = game.achievementCount ?? 0;
          return (
            <li
              key={game.slug}
              className="group relative flex gap-5 rounded-[4px] border border-line bg-surface p-4 transition-colors hover:border-line-2"
            >
              <span className="block aspect-[3/4] w-24 flex-none overflow-hidden rounded-[2px_5px_5px_2px] shadow-[-4px_0_0_#0d0e12,0_14px_24px_-10px_rgba(0,0,0,.85)]">
                <GameCoverThumb
                  coverUrl={game.coverUrl}
                  variant="case"
                  seed={hashSeed(game.slug)}
                  hues={artHues(game.slug, game.slug)}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-2.5">
                <b className="text-[21px] leading-[1.1] font-black font-stretch-[112%] tracking-[-0.02em] text-balance">
                  {/* The whole card opens the game; the guide link sits above it. */}
                  <Link
                    href={`/jogos/${game.slug}`}
                    aria-label={`Ver jogo: ${game.name}`}
                    className="after:absolute after:inset-0 after:content-[''] hover:text-acc"
                  >
                    {game.name}
                  </Link>
                </b>
                {game.platforms && game.platforms.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5 font-mono text-xs tracking-[0.1em] uppercase">
                    <PlatformChips platforms={game.platforms} />
                  </span>
                ) : null}
                <span className="font-mono text-xs text-muted">
                  {count > 0 ? (
                    <>
                      <b className="font-bold text-text">{count.toLocaleString("pt-BR")}</b> {count === 1 ? "conquista" : "conquistas"}
                      {game.hasPlatinum ? <span className="text-tier-plat"> · platina</span> : null}
                    </>
                  ) : (
                    "Conquistas ainda não cadastradas"
                  )}
                </span>
                <span className="mt-auto flex flex-wrap gap-x-5">
                  <span className={`${gameLink} pointer-events-none`} aria-hidden="true">
                    Ver jogo →
                  </span>
                  {game.hasGuide ? (
                    <Link
                      href={`/jogos/${game.slug}/guia`}
                      aria-label={`Abrir guia 100% de ${game.name}`}
                      className={`${gameLink} relative z-[1]`}
                    >
                      Abrir guia 100% →
                    </Link>
                  ) : null}
                </span>
              </span>
            </li>
          );
        })}
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

/** Reading width of the article's text; the art and the way out use the site's full grid. */
const prose = "mx-auto w-full max-w-[860px]";

function ArticleLayout({ article }: { article: ArticleFull }) {
  return (
    <article className="flex w-full flex-col gap-10">
      <header className={`${prose} flex flex-col gap-4`}>
        <Link
          href="/noticias"
          className="-my-3 inline-flex min-h-11 items-center self-start font-mono text-xs tracking-[0.08em] text-acc uppercase underline-offset-4 hover:underline"
        >
          ← Notícias
        </Link>
        <ArticleTags article={article} />
        <h1 className="text-[clamp(30px,4vw,48px)] leading-[1.02] font-black font-stretch-[112%] tracking-[-0.035em]">
          {article.title}
        </h1>
        {article.subtitle ? <p className="text-lg text-text-3">{article.subtitle}</p> : null}
        <GameChips article={article} />
        <div className="flex flex-wrap gap-3.5 font-mono text-xs text-dim">
          {/* Robot articles are signed "Equipe Tralked"; only people's articles get "Autoria humana". */}
          <span className="text-text-2">{article.authorLabel}</span>
          <time dateTime={article.publishedAt.toISOString()}>{DATE_FORMAT.format(article.publishedAt)}</time>
          {/* Counters show only when there is something to count. */}
          {article.views > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <EyeIcon width={14} height={14} />
              {article.views.toLocaleString("pt-BR")} {article.views === 1 ? "visualização" : "visualizações"}
            </span>
          ) : null}
          {article.comments > 0 ? (
            <a href="#comentarios" className="hover:text-text">
              ◼ {article.comments} {article.comments === 1 ? "comentário" : "comentários"}
            </a>
          ) : null}
          {article.source !== "bot" && article.humanAuthored ? (
            <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
              Autoria humana
            </span>
          ) : null}
        </div>
      </header>

      <div className="aspect-[21/9] overflow-hidden rounded-[3px] bg-surface max-sm:aspect-[16/9]">
        <FramedArt
          art={article.heroArt}
          fallbackUrl={article.heroUrl}
          ratio={21 / 9}
          mode="scene"
          pick={article.slug}
          exclude={new Set(article.heroExclude ?? [])}
          seed={hashSeed(article.slug)}
          hues={artHues(article.game?.slug, article.slug)}
          figure
          light
          width={1280}
          height={548}
          sizes="(max-width: 1320px) calc(100vw - 40px), 1280px"
          priority
        />
      </div>

      <div className={`${prose} flex flex-col gap-10`}>
        {article.blocks.length > 0 ? (
          <Blocks blocks={withHuntCallout(article.blocks, article.games[0] ?? null)} achievements={article.achievements} />
        ) : (
          <ArticleBody markdown={article.body} />
        )}

        <div className="flex flex-col gap-3">
          <ReactionBar
            targetType="article"
            targetId={article.id}
            prompt="O que achou desta notícia?"
            what="esta notícia"
            returnTo={`/noticias/${article.slug}`}
          />
          {/* Session island: newsroom tools for admin/editor, "Denunciar" for everyone else. With the
              reader's other reactions, after the text (not between the headline and the picture). */}
          <ArticleModeration
            articleId={article.id}
            category={article.category}
            featured={article.featured}
            returnTo={`/noticias/${article.slug}`}
          />
        </div>

        {/* No ad provider yet: no empty "Publicidade" box until there is one. */}
        {adsEnabled() ? <AdSlot format="leaderboard" /> : null}

        <RelatedGames article={article} />
        <ExternalSources article={article} />

        {/* Comments island (#comentarios): streams the comments and the visitor's session. */}
        <div className="border-t border-line pt-8">
          <Comments targetType="article" targetId={article.id} />
        </div>
      </div>

      <ArticleEnd id={article.id} publishedAt={article.publishedAt} />
    </article>
  );
}

/** After the comments: the next story as a big card, then the most viewed. Never a dead end. */
async function ArticleEnd({ id, publishedAt }: { id: string; publishedAt: Date }) {
  const { next, most, mostTitle } = await loadArticleEnd(id, publishedAt.toISOString());
  if (!next && most.length === 0) return null;
  return (
    <div className="grid items-start gap-12 border-t border-line pt-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      {next ? <NextStory article={next} /> : null}
      {most.length > 0 ? <MostViewed title={mostTitle} articles={most} /> : null}
    </div>
  );
}

function NextStory({ article }: { article: ArticleCard }) {
  return (
    <section aria-labelledby="h-proxima" className="flex flex-col gap-4">
      <h2 id="h-proxima" className={sectionTitle}>
        Próxima matéria
      </h2>
      <Link
        href={`/noticias/${article.slug}`}
        className="group relative flex min-h-[320px] flex-col justify-end overflow-hidden rounded-[4px] bg-surface p-5 transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)] sm:min-h-[400px] sm:p-8 motion-reduce:transition-none"
      >
        <FramedArt
          art={article.art}
          fallbackUrl={article.imageUrl}
          ratio={3}
          mode="scene"
          pick={article.slug}
          seed={hashSeed(article.slug)}
          hues={artHues(article.game?.slug, article.slug)}
          figure
          light
          width={960}
          height={540}
          sizes="(max-width: 1024px) calc(100vw - 40px), 780px"
          className="absolute inset-0 object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,.05)_15%,rgba(11,12,15,.96)_85%)]"
        />
        <span className="relative flex max-w-[640px] flex-col gap-3.5">
          <ArticleTags article={article} onImage />
          <b className="text-[clamp(26px,3.6vw,42px)] leading-[1] font-black font-stretch-[112%] tracking-[-0.03em] text-balance">
            {article.title}
          </b>
          {article.subtitle ? <span className="max-w-[60ch] text-[16px] text-text-2">{article.subtitle}</span> : null}
          <span className="inline-flex items-center gap-2 font-mono text-xs font-bold tracking-[0.1em] text-acc uppercase">
            Ler agora
            <ArrowRightIcon width={16} height={16} className="transition-transform duration-200 ease-out group-hover:translate-x-1" />
          </span>
        </span>
      </Link>
    </section>
  );
}

function MostViewed({ title, articles }: { title: string; articles: ArticleCard[] }) {
  return (
    <section aria-labelledby="h-mais-vistas" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="h-mais-vistas" className={sectionTitle}>
          {title}
        </h2>
        {/* 44 px to tap, without pushing the heading off the "Próxima matéria" line beside it. */}
        <Link
          href="/noticias"
          className="-my-3 inline-flex min-h-11 items-center font-mono text-xs tracking-[0.08em] text-acc uppercase underline-offset-4 hover:underline"
        >
          Todas as notícias →
        </Link>
      </div>
      <ol className="m-0 grid list-none gap-x-8 p-0 sm:max-lg:grid-cols-2">
        {articles.map((article, i) => (
          <li key={article.id} className="border-b border-divider">
            <Link href={`/noticias/${article.slug}`} className="group flex items-center gap-4 py-3.5">
              <span
                aria-hidden="true"
                className="w-7 flex-none text-[30px] leading-none font-black font-stretch-[125%] text-dim tabular-nums transition-colors duration-150 group-hover:text-acc"
              >
                {i + 1}
              </span>
              <span className="block h-[60px] w-[96px] flex-none overflow-hidden rounded-[2px] bg-surface">
                <FramedArt
                  art={article.art}
                  fallbackUrl={article.imageUrl}
                  ratio={96 / 60}
                  mode="scene"
                  pick={article.slug}
                  seed={hashSeed(article.slug)}
                  hues={artHues(article.game?.slug, article.slug)}
                  width={96}
                  height={60}
                  sizes="96px"
                  className="size-full object-cover"
                />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <b className="line-clamp-2 text-[15.5px] leading-snug font-bold transition-colors duration-150 group-hover:text-acc">
                  {article.title}
                </b>
                {article.views > 0 ? (
                  <span className="font-mono text-xs text-dim">
                    {article.views.toLocaleString("pt-BR")} {article.views === 1 ? "visualização" : "visualizações"}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
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
      <ArticleViewBeacon articleId={article.id} />
      <div className="mt-16">
        <Newsletter variant="block" />
      </div>
    </>
  );
}
