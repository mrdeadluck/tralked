import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameArt } from "@/components/art/GameArt";
import { ArticleBody } from "@/components/news/ArticleBody";
import { ArticleTags } from "@/components/news/ArticleTags";
import { Blocks } from "@/lib/content/render";
import { isSafeHttpUrl } from "@/lib/content/url";
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
  const slugs = await getAllArticleSlugs();
  return slugs.map((slug) => ({ slug }));
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

function RelatedGames({ article }: { article: ArticleFull }) {
  if (article.games.length === 0) return null;
  return (
    <section aria-labelledby="h-jogos" className="flex flex-col gap-4">
      <h2 id="h-jogos" className={sectionTitle}>
        {article.games.length > 1 ? "Jogos desta notícia" : "Jogo desta notícia"}
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
        {article.games.map((game) => (
          <li key={game.slug}>
            <Link
              href={`/jogos/${game.slug}${game.hasGuide ? "/guia" : ""}`}
              className="group flex items-center gap-4 rounded-[4px] border border-line bg-surface p-3 transition-colors hover:border-acc"
            >
              <span className="block h-16 w-12 flex-none overflow-hidden rounded-[2px]">
                <GameArt seed={hashSeed(game.slug)} hues={artHues(game.slug, game.slug)} figure light width={120} height={160} />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <b className="truncate text-[17px] font-extrabold">{game.name}</b>
                <span className="font-mono text-[11px] tracking-[0.08em] text-acc uppercase">
                  {game.hasGuide ? "Abrir guia 100%" : "Ver jogo"} →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
              <span className="font-mono text-[11px] text-dim">
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
        <Link href="/noticias" className="self-start font-mono text-[11px] tracking-[0.08em] text-acc uppercase">
          ← Notícias
        </Link>
        <ArticleTags article={article} />
        <h1 className="text-[clamp(30px,4vw,48px)] leading-[1.02] font-black font-stretch-[112%] tracking-[-0.035em]">
          {article.title}
        </h1>
        {article.subtitle ? <p className="text-lg text-text-3">{article.subtitle}</p> : null}
        <div className="flex flex-wrap gap-3.5 font-mono text-xs text-dim">
          {/* Bot authors are "Robô <key name>", not a user handle. */}
          <span className="text-text-2">
            {article.source === "bot" ? article.authorHandle : `@${article.authorHandle}`}
          </span>
          <time dateTime={article.publishedAt.toISOString()}>{DATE_FORMAT.format(article.publishedAt)}</time>
          <span>▲ {article.likes}</span>
          <a href="#comentarios" className="hover:text-text">
            ◼ {article.comments} comentários
          </a>
          {article.source === "bot" ? (
            <span className="text-text-3">
              {article.reviewed ? "Gerado por robô · revisado pela redação" : "Gerado por robô"}
            </span>
          ) : article.humanAuthored ? (
            <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
              Autoria humana
            </span>
          ) : null}
        </div>
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

      <RelatedGames article={article} />
      <ExternalSources article={article} />

      {/* Slot for the comments island (Task 8 mounts <Comments> here). */}
      <section id="comentarios" aria-labelledby="h-comentarios" className="flex scroll-mt-24 flex-col gap-3 border-t border-line pt-8">
        <h2 id="h-comentarios" className={sectionTitle}>
          Comentários
        </h2>
        <p className="text-[15px] text-muted">Os comentários desta notícia chegam em breve.</p>
      </section>
    </article>
  );
}

export default async function NoticiaPage({ params }: PageProps<"/noticias/[slug]">) {
  // The article comes from cache, so an unknown slug is a real 404 before anything streams.
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) notFound();

  return <ArticleLayout article={article} />;
}
