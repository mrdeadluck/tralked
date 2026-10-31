import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/news/ArticleBody";
import { ArticleTags } from "@/components/news/ArticleTags";
import { Card } from "@/components/ui/Card";
import { Placeholder } from "@/components/ui/Placeholder";
import { getAllArticleSlugs, getArticle, type ArticleFull } from "@/lib/queries/news";

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeZone: "America/Sao_Paulo",
});

async function loadArticle(slug: string): Promise<ArticleFull | null> {
  "use cache";
  cacheLife("minutes");
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
  if (!article) return { title: "Notícia não encontrada" };
  return {
    title: `${article.title} | Tralked`,
    description: article.subtitle ?? undefined,
  };
}

function ArticleLayout({ article }: { article: ArticleFull }) {
  return (
    <article className="mx-auto flex max-w-[860px] flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.08em] text-acc uppercase"
        >
          ← Notícias
        </Link>
        <ArticleTags article={article} />
        <h1 className="text-[clamp(30px,4vw,48px)] leading-[1.02] font-black font-stretch-[112%] tracking-[-0.035em]">
          {article.title}
        </h1>
        {article.subtitle ? (
          <p className="text-lg text-text-3">{article.subtitle}</p>
        ) : null}
        <div className="flex flex-wrap gap-3.5 font-mono text-xs text-dim">
          <span className="text-text-2">@{article.authorHandle}</span>
          <time dateTime={article.publishedAt.toISOString()}>
            {DATE_FORMAT.format(article.publishedAt)}
          </time>
          <span>▲ {article.likes}</span>
          <span>◼ {article.comments}</span>
          {article.humanAuthored ? (
            <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
              Autoria humana
            </span>
          ) : null}
        </div>
      </header>

      <Placeholder label={article.imageLabel} ratio="21 / 9" />

      <ArticleBody markdown={article.body} />

      {article.game ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] tracking-[0.14em] text-dim uppercase">
              {article.game.hasGuide ? "Guia relacionado" : "Jogo relacionado"}
            </span>
            <b className="text-xl font-extrabold">{article.game.name}</b>
          </div>
          <Link
            href={`/jogos/${article.game.slug}`}
            className="font-mono text-xs font-bold tracking-[0.1em] text-acc uppercase"
          >
            {article.game.hasGuide ? "Abrir guia" : "Ver jogo"} →
          </Link>
        </Card>
      ) : null}
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
