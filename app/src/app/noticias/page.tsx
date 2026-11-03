import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FramedArt } from "@/components/art/FramedArt";
import { Newsletter } from "@/components/layout/Newsletter";
import { HeroMain } from "@/components/news/HeroMain";
import { NewsWire } from "@/components/news/NewsWire";
import { SectionHead } from "@/components/ui/SectionHead";
import {
  articleStory,
  spreadArt,
  buildWireItems,
  CATEGORIES,
  categoryFromSlug,
  getWireHeadlines,
  getLatestArticles,
  getNewsIndex,
  getAreaHeadlines,
  headlineStory,
  isPressArea,
  NEWS_TAG,
  pressAreaLabel,
  type ArticleCategory,
  type PressArea,
} from "@/lib/queries/news";
import { timeAgo } from "@/lib/time-ago";

export const metadata: Metadata = {
  title: "Notícias | Tralked",
  description: "Notícias de games, guias de conquistas e a vida da comunidade, da redação do Tralked.",
};

const PAGE_SIZE = 20;

/** The page's single headline: the newest article, cached. */
async function loadHeadline() {
  "use cache";
  cacheLife("feed");
  cacheTag(NEWS_TAG);
  const [article] = await getLatestArticles(1);
  if (!article) return null;
  return { ...article, timeAgo: timeAgo(article.publishedAt, new Date()) };
}

/**
 * One headline, then the press's headlines in the wire. The newsroom's stories live only in the
 * archive below (which leaves the headline out), so no story shows twice on the page.
 */
async function FrontSection() {
  "use cache";
  cacheLife("feed");
  cacheTag(NEWS_TAG);

  const [headline, external] = await Promise.all([loadHeadline(), getWireHeadlines(10)]);
  const items = buildWireItems([], external, new Date());
  return (
    <>
      {headline ? (
        <section aria-label="Manchete" className="flex">
          <HeroMain article={headline} sizes="(max-width: 1320px) calc(100vw - 40px), 1280px" />
        </section>
      ) : null}
      {items.length > 0 ? (
        <NewsWire
          items={items}
          description="Manchetes da imprensa de games, atualizadas a cada hora"
          label="Na imprensa"
          className="tkw-compact"
        />
      ) : null}
    </>
  );
}

async function loadIndex(category: ArticleCategory | null, page: number) {
  "use cache";
  cacheLife("feed");
  cacheTag(NEWS_TAG);
  const index = await getNewsIndex({ category, page, pageSize: PAGE_SIZE });
  const now = new Date();
  // The headline above the first page claims its picture first: the list below never repeats it,
  // nor two stories of one game in a row (spreadArt).
  const [head] = page === 1 && !category ? await getLatestArticles(1) : [];
  const spread = spreadArt(head ? [head, ...index.articles] : index.articles);
  const articles = head ? spread.slice(1) : spread;
  return { ...index, articles, stories: articles.map((a) => articleStory(a, now)) };
}

/** Latest press headlines of an area for its archive filter (Plan 4 F7), cached. */
async function loadPress(area: PressArea) {
  "use cache";
  cacheLife("feed");
  cacheTag(NEWS_TAG);
  const now = new Date();
  return (await getAreaHeadlines(area, 10)).map((h) => headlineStory(h, now));
}

/** "Na imprensa": external headlines of Entretenimento / Tecnologia, clearly marked as external. */
async function PressList({ area }: { area: PressArea }) {
  const stories = await loadPress(area);
  if (stories.length === 0) return null;
  const label = pressAreaLabel(area);
  return (
    <section aria-labelledby="h-na-imprensa" className="flex flex-col gap-2 pt-10">
      <h3 id="h-na-imprensa" className="text-[19px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
        Na imprensa: {label}
      </h3>
      <p className="max-w-[68ch] text-[14px] text-muted">
        Manchetes de outros sites sobre {label.toLowerCase()} ligado a games. O Tralked guarda só o título, o link,
        a fonte e a data; a matéria completa abre no site da fonte.
      </p>
      <ul className="m-0 list-none p-0">
        {stories.map((story) => (
          <li key={story.id} className="border-b border-divider last:border-b-0">
            <a href={story.href} target="_blank" rel="noopener noreferrer" className="group flex flex-col gap-1 py-3">
              <span className="font-mono text-xs tracking-[0.12em] text-acc uppercase">{story.kicker}</span>
              <span className="text-[16px] leading-snug font-bold group-hover:text-acc">
                {story.title}
                <span className="sr-only"> (abre em nova aba)</span>
              </span>
              <span className="font-mono text-xs text-dim">
                {story.source} · {story.when}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function indexHref(category: string | null, page: number) {
  const params = new URLSearchParams();
  if (category) params.set("categoria", category);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return `/noticias${query ? `?${query}` : ""}#todas`;
}

const chip =
  "inline-flex h-[34px] items-center rounded-[2px] border px-3 font-mono text-xs tracking-[0.08em] uppercase transition-colors";

/** Reads `?categoria=` and `?pagina=` at request time; the page data itself is cached per pair. */
async function Archive({ searchParams }: { searchParams: PageProps<"/noticias">["searchParams"] }) {
  const params = await searchParams;
  const categorySlug = first(params.categoria) ?? null;
  const category = categoryFromSlug(categorySlug ?? undefined);
  const activeSlug = category ? categorySlug : null;
  const requested = Number.parseInt(first(params.pagina) ?? "1", 10);
  const [index, headline] = await Promise.all([
    loadIndex(category, Number.isFinite(requested) ? requested : 1),
    loadHeadline(),
  ]);
  const { page, pageCount, total } = index;
  // The headline already leads the page: the unfiltered first page leaves it out.
  const stories = index.stories.filter((s) => category || page > 1 || s.id !== headline?.id);

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
                  <FramedArt
                    art={story.art}
                    fallbackUrl={story.imageUrl}
                    ratio={16 / 10}
                    mode="scene"
                    pick={story.id}
                    exclude={new Set(story.artExclude ?? [])}
                    seed={story.seed}
                    hues={story.hues}
                    figure
                    width={480}
                    height={300}
                    sizes="(max-width: 640px) calc(100vw - 40px), 240px"
                    className="transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                </div>
                <div className="flex min-w-0 flex-col justify-center gap-2.5">
                  <span className="font-mono text-xs tracking-[0.12em] text-acc uppercase">{story.kicker}</span>
                  <h3 className="text-[23px] leading-[1.12] font-extrabold font-stretch-[105%] tracking-[-0.02em]">
                    {story.title}
                  </h3>
                  {story.excerpt ? <p className="max-w-[68ch] text-[15.5px] text-muted">{story.excerpt}</p> : null}
                  <span className="flex flex-wrap gap-3.5 font-mono text-xs text-dim">
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

      {isPressArea(category) ? <PressList area={category} /> : null}
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

      {/* Room for the headline and the press wire while they stream, so the archive below stays put. */}
      <Suspense
        fallback={
          <>
            <div aria-hidden="true" className="min-h-[460px] rounded-[4px] bg-surface max-sm:min-h-[400px]" />
            <div aria-hidden="true" className="h-[370px] max-[1000px]:h-[404px] max-sm:h-[422px]" />
          </>
        }
      >
        <FrontSection />
      </Suspense>

      <section id="todas" aria-label="Todas as notícias" className="flex scroll-mt-24 flex-col">
        <SectionHead title="Todas as notícias" />
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

      <Newsletter variant="block" />
    </div>
  );
}
