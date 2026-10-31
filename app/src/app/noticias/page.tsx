import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { GameArt } from "@/components/art/GameArt";
import { NewsTabs } from "@/components/news/NewsTabs";
import { NewsWire } from "@/components/news/NewsWire";
import { SectionHead } from "@/components/ui/SectionHead";
import {
  articleStory,
  buildNewsTabs,
  buildWireItems,
  CATEGORIES,
  categoryFromSlug,
  getExternalHeadlines,
  getLatestArticles,
  getMostRead,
  getNewsIndex,
  NEWS_TAG,
  type ArticleCategory,
} from "@/lib/queries/news";

export const metadata: Metadata = {
  title: "Notícias | Tralked",
  description: "Notícias de games, guias de conquistas e a vida da comunidade, da redação do Tralked.",
};

const PAGE_SIZE = 8;

/** Wire and category tabs: public and the same for everyone, so cached into the static shell. */
async function FrontSection() {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);

  const [articles, external, mostRead] = await Promise.all([
    getLatestArticles(30),
    getExternalHeadlines(6),
    getMostRead(5),
  ]);
  const now = new Date();
  return (
    <>
      <NewsWire
        items={buildWireItems(articles, external, now)}
        description="Da redação e da imprensa de games, atualizado a cada hora"
        label="Notícias em movimento"
      />
      <section aria-label="Notícias por categoria" className="flex flex-col gap-1">
        <SectionHead title="Por categoria" />
        <NewsTabs tabs={buildNewsTabs(articles, now)} mostRead={mostRead.map((a) => articleStory(a, now))} />
      </section>
    </>
  );
}

async function loadIndex(category: ArticleCategory | null, page: number) {
  "use cache";
  cacheLife("minutes");
  cacheTag(NEWS_TAG);
  const index = await getNewsIndex({ category, page, pageSize: PAGE_SIZE });
  const now = new Date();
  return { ...index, stories: index.articles.map((a) => articleStory(a, now)) };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function indexHref(category: string | null, page: number) {
  const params = new URLSearchParams();
  if (category) params.set("categoria", category);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return `/noticias${query ? `?${query}` : ""}#arquivo`;
}

const chip =
  "inline-flex h-[34px] items-center rounded-[2px] border px-3 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors";

/** Reads `?categoria=` and `?pagina=` at request time; the page data itself is cached per pair. */
async function Archive({ searchParams }: { searchParams: PageProps<"/noticias">["searchParams"] }) {
  const params = await searchParams;
  const categorySlug = first(params.categoria) ?? null;
  const category = categoryFromSlug(categorySlug ?? undefined);
  const activeSlug = category ? categorySlug : null;
  const requested = Number.parseInt(first(params.pagina) ?? "1", 10);
  const { stories, page, pageCount, total } = await loadIndex(category, Number.isFinite(requested) ? requested : 1);

  return (
    <>
      <nav aria-label="Filtrar por categoria" className="flex flex-wrap gap-1.5 pt-4">
        {[{ slug: null, label: "Todas" }, ...CATEGORIES].map((c) => {
          const active = c.slug === activeSlug;
          return (
            <Link
              key={c.label}
              href={indexHref(c.slug, 1)}
              aria-current={active ? "page" : undefined}
              className={`${chip} ${
                active
                  ? "border-text bg-text text-bg"
                  : "border-line-2 text-text-3 hover:border-dim hover:text-text"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>

      {stories.length === 0 ? (
        <p className="py-10 text-[15px] text-muted">Nenhuma notícia nesta categoria ainda.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {stories.map((story) => (
            <li key={story.id} className="border-b border-line">
              <Link
                href={story.href}
                className="group -mx-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 rounded-[3px] px-3 py-6 transition-colors duration-150 hover:bg-surface sm:grid-cols-[240px_minmax(0,1fr)]"
              >
                <div className="aspect-[16/10] overflow-hidden rounded-[3px] bg-surface">
                  <GameArt
                    seed={story.seed}
                    hues={story.hues}
                    imageUrl={story.imageUrl}
                    figure
                    width={480}
                    height={300}
                    className="transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                </div>
                <div className="flex min-w-0 flex-col justify-center gap-2.5">
                  <span className="font-mono text-[10px] tracking-[0.12em] text-acc uppercase">{story.kicker}</span>
                  <h3 className="text-[23px] leading-[1.12] font-extrabold font-stretch-[105%] tracking-[-0.02em]">
                    {story.title}
                  </h3>
                  {story.excerpt ? <p className="max-w-[68ch] text-[15.5px] text-muted">{story.excerpt}</p> : null}
                  <span className="flex flex-wrap gap-3.5 font-mono text-[11.5px] text-dim">
                    <span className="text-text-2">{story.source}</span>
                    <span>{story.when}</span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {pageCount > 1 ? (
        <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-4 pt-6">
          {page > 1 ? (
            <Link href={indexHref(activeSlug, page - 1)} className={`${chip} border-line-2 hover:border-text`}>
              ← Mais recentes
            </Link>
          ) : (
            <span />
          )}
          <span className="font-mono text-xs text-dim">
            Página {page} de {pageCount} · {total} notícias
          </span>
          {page < pageCount ? (
            <Link href={indexHref(activeSlug, page + 1)} className={`${chip} border-line-2 hover:border-text`}>
              Mais antigas →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}

export default function NoticiasPage({ searchParams }: PageProps<"/noticias">) {
  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-[clamp(34px,4.6vw,60px)] leading-[.95] font-black font-stretch-[125%] tracking-[-0.04em] uppercase">
          Notícias
        </h1>
        <p className="max-w-[60ch] text-[17px] text-text-3">
          O que sai sobre os seus jogos: reportagens e guias da redação, a vida da comunidade e as
          manchetes da imprensa de games.
        </p>
      </header>

      <Suspense fallback={null}>
        <FrontSection />
      </Suspense>

      <section id="arquivo" aria-label="Arquivo de notícias" className="flex scroll-mt-24 flex-col">
        <SectionHead title="Arquivo" />
        <Suspense
          fallback={
            <div
              aria-busy="true"
              aria-label="Carregando notícias"
              className="mt-6 h-[480px] animate-pulse rounded-[4px] border border-line bg-surface"
            />
          }
        >
          <Archive searchParams={searchParams} />
        </Suspense>
      </section>
    </div>
  );
}
