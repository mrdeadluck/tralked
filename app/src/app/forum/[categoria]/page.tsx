import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ForumList } from "@/components/community/ForumList";
import { NewThreadForm } from "@/components/community/NewThreadForm";
import { PageHead, Trail } from "@/components/community/PageHead";
import { Pager, pageParam } from "@/components/community/Pager";
import { findSectionCached, listSectionThreadsCached } from "@/lib/community/cached";
import { sectionSegments, type ForumSection } from "@/lib/community/forum";
import { plural } from "@/lib/community/format";
import { currentViewer } from "@/lib/community/viewer";

export async function generateStaticParams() {
  const segments = await sectionSegments();
  return (segments.length > 0 ? segments : ["geral"]).map((categoria) => ({ categoria }));
}

export async function generateMetadata({ params }: PageProps<"/forum/[categoria]">): Promise<Metadata> {
  const { categoria } = await params;
  const section = await findSectionCached(categoria);
  if (!section) return { title: "Seção não encontrada | Tralked" };
  // A game's section without topics (nearly every catalog game) is an empty list: out of the
  // index, as robots.txt keeps crawlers off it (lib/seo/robots.ts EMPTY_LISTING_PATHS).
  const empty = section.kind === "game" && (await listSectionThreadsCached(section, 1)).total === 0;
  return {
    title: section.kind === "game" ? `Fórum de ${section.name} | Tralked` : `${section.name} | Fórum Tralked`,
    description: section.description,
    ...(empty && { robots: { index: false, follow: true } }),
  };
}

export default async function ForumSectionPage({ params, searchParams }: PageProps<"/forum/[categoria]">) {
  const { categoria } = await params;
  const section = await findSectionCached(categoria);
  if (!section) notFound();
  const returnTo = `/forum/${section.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title={section.kind === "game" ? `Fórum de ${section.name}` : section.name}
        lede={section.description}
        trail={
          <Trail>
            <Link href="/forum" className="hover:text-acc">
              Fórum
            </Link>
            {section.kind === "game" ? (
              <>
                {" / "}
                <Link href={`/jogos/${section.slug}`} className="hover:text-acc">
                  Página do jogo
                </Link>
              </>
            ) : null}
          </Trail>
        }
      />

      <Suspense
        fallback={<NewThreadForm section={section.slug} sectionName={section.name} loggedIn={false} returnTo={returnTo} pending />}
      >
        <NewThreadIsland section={section} returnTo={returnTo} />
      </Suspense>

      <Suspense fallback={<div aria-busy="true" aria-label="Carregando tópicos" className="h-[320px] animate-pulse rounded-[4px] bg-surface" />}>
        <Threads section={section} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewThreadIsland({ section, returnTo }: { section: ForumSection; returnTo: string }) {
  const viewer = await currentViewer();
  return (
    <div className="self-start">
      <NewThreadForm section={section.slug} sectionName={section.name} loggedIn={viewer !== null} returnTo={returnTo} />
    </div>
  );
}

async function Threads({
  section,
  searchParams,
}: {
  section: ForumSection;
  searchParams: PageProps<"/forum/[categoria]">["searchParams"];
}) {
  const { pagina } = await searchParams;
  const listing = await listSectionThreadsCached(section, pageParam(pagina));
  return (
    <section aria-label={`Tópicos de ${section.name}`} className="flex flex-col gap-3">
      <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
        {plural(listing.total, "tópico", "tópicos")}
      </p>
      <ForumList
        threads={listing.threads}
        label={`Tópicos de ${section.name}`}
        empty={
          section.kind === "game"
            ? `Ninguém abriu um tópico sobre ${section.name} ainda. Comece a conversa!`
            : "Nenhum tópico nesta seção ainda. Comece a conversa!"
        }
      />
      <Pager
        page={listing.page}
        pageCount={listing.pageCount}
        href={(page) => (page > 1 ? `/forum/${section.slug}?pagina=${page}` : `/forum/${section.slug}`)}
        label="Páginas de tópicos"
      />
    </section>
  );
}
