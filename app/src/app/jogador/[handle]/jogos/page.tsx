import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { LibraryCoverGrid } from "@/components/profile/LibraryCoverGrid";
import { LibraryGameRow } from "@/components/profile/LibraryGameRow";
import { PrivateProfile, SectionSkeleton } from "@/components/profile/PrivateProfile";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { profilePath, ProfileTabs } from "@/components/profile/ProfileTabs";
import { LinkChips } from "@/components/ui/LinkChips";
import { ListSearch } from "@/components/ui/ListSearch";
import { Pagination } from "@/components/ui/Pagination";
import type { PlatformId } from "@/lib/engine/trophies";
import { getUserLibrary } from "@/lib/library/queries";
import { hrefWith, PAGE_PARAM, paginate, parsePagination, perPageParam, pickParams } from "@/lib/pagination";
import { profileAccess, sectionMetadata } from "@/lib/profile/access";
import {
  filterLibrary,
  libraryPlatforms,
  PROFILE_GAME_SORTS,
  sortLibrary,
  splitSections,
  type LibrarySection,
  type ProfileGameSort,
} from "@/lib/profile/library-view";
import { getProfileSummary } from "@/lib/profile/queries";
import type { PlayerHeader } from "@/lib/queries/players";
import { getPlayerHeaderCached } from "@/lib/queries/players-cached";
import { cleanQuery } from "@/lib/search/fold";

const KEYS = ["q", "plataforma", "ordem", "secao", "vista", "por", PAGE_PARAM] as const;
const SORT_LABEL: Record<ProfileGameSort, string> = {
  horas: "Horas",
  recentes: "Recentes",
  conclusao: "Conclusão",
  nome: "Nome",
};

export async function generateStaticParams() {
  // Same as the sheet: a sample for Cache Components; every handle renders on demand.
  return [{ handle: "exemplo" }];
}

export async function generateMetadata({ params }: PageProps<"/jogador/[handle]/jogos">): Promise<Metadata> {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  return sectionMetadata(header, "Jogos", "/jogos", "Biblioteca completa: horas, conquistas e última vez jogado em cada jogo.");
}

export default async function ProfileGamesPage({ params, searchParams }: PageProps<"/jogador/[handle]/jogos">) {
  const { handle } = await params;
  const header = await getPlayerHeaderCached(handle);
  if (!header) notFound();
  return (
    <Suspense fallback={<SectionSkeleton label="Carregando jogos" />}>
      <ProfileGames header={header} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProfileGames({
  header,
  searchParams,
}: {
  header: PlayerHeader;
  searchParams: PageProps<"/jogador/[handle]/jogos">["searchParams"];
}) {
  const { visible } = await profileAccess(header);
  if (!visible) return <PrivateProfile displayName={header.displayName} />;

  const params = await searchParams;
  const [summary, library] = await Promise.all([getProfileSummary(header.id), getUserLibrary(header.id)]);
  if (!summary) notFound();

  const state = pickParams(params, KEYS);
  const platforms = libraryPlatforms(library);
  const platform = platforms.find((p) => p === state.plataforma) as PlatformId | undefined;
  const sort = (PROFILE_GAME_SORTS as readonly string[]).includes(state.ordem ?? "") ? (state.ordem as ProfileGameSort) : "horas";
  const section: LibrarySection = state.secao === "nunca" ? "nunca" : "jogados";
  // The cover grid is the main view; the rows (hours, unlocks, last played) stay one click away.
  const view = state.vista === "lista" ? "lista" : "capas";
  const q = cleanQuery(state.q);
  const { page, perPage } = parsePagination(params);

  const base = profilePath(header.handle, "jogos");
  const kept: Record<string, string | undefined> = {
    q,
    plataforma: platform,
    ordem: sort === "horas" ? undefined : sort,
    secao: section === "nunca" ? "nunca" : undefined,
    vista: view === "lista" ? "lista" : undefined,
    por: perPageParam(perPage),
  };
  const link = (changes: Record<string, string | undefined>) => hrefWith(base, kept, { ...changes, [PAGE_PARAM]: undefined });

  const sections = splitSections(filterLibrary(library, { platform, q }));
  const list = paginate(sortLibrary(sections[section], sort), page, perPage);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <ProfileHeader summary={summary} section="Jogos" />
        <ProfileTabs handle={header.handle} active="jogos" summary={summary} />
      </div>

      {library.length === 0 ? (
        <p className="py-6 text-muted">
          Nenhum jogo ainda. A biblioteca aparece quando uma plataforma é conectada e sincronizada.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 bg-surface p-3 tk-cut [&>form]:basis-full">
            <ListSearch
              basePath={base}
              params={kept}
              q={q}
              label="Buscar na biblioteca"
              placeholder="Nome do jogo"
            />
            <LinkChips
              label="Jogados ou nunca jogados"
              options={[
                { id: "jogados", label: "Jogados", count: sections.jogados.length, href: link({ secao: undefined }) },
                { id: "nunca", label: "Nunca jogados", count: sections.nunca.length, href: link({ secao: "nunca" }) },
              ]}
              current={section}
            />
            {platforms.length > 1 ? (
              <LinkChips
                label="Filtrar por plataforma"
                caption="Plataforma"
                options={[
                  { id: "todas", label: "Todas", href: link({ plataforma: undefined }) },
                  ...platforms.map((p) => ({
                    id: p,
                    label: PLATFORM_LABEL[p],
                    color: PLATFORM_TOKEN[p],
                    href: link({ plataforma: p }),
                  })),
                ]}
                current={platform ?? "todas"}
              />
            ) : null}
            <LinkChips
              label="Ordenar jogos"
              caption="Ordenar"
              options={PROFILE_GAME_SORTS.map((s) => ({
                id: s,
                label: SORT_LABEL[s],
                href: link({ ordem: s === "horas" ? undefined : s }),
              }))}
              current={sort}
            />
            <LinkChips
              label="Ver como capas ou lista"
              caption="Ver"
              options={[
                { id: "capas", label: "Capas", href: link({ vista: undefined }) },
                { id: "lista", label: "Lista", href: link({ vista: "lista" }) },
              ]}
              current={view}
            />
          </div>

          <section aria-labelledby="lista-jogos">
            <h2 id="lista-jogos" className="mb-2 tk-lbl text-text-2" aria-live="polite">
              {section === "nunca" ? "Nunca jogados" : "Jogados"}: {list.total.toLocaleString("pt-BR")}{" "}
              {list.total === 1 ? "jogo" : "jogos"}
              {q ? ` para “${q}”` : ""}
            </h2>
            {list.items.length > 0 ? (
              view === "capas" ? (
                <LibraryCoverGrid games={list.items} label="Jogos da biblioteca" />
              ) : (
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {list.items.map((game) => (
                    <LibraryGameRow key={game.gameId} game={game} />
                  ))}
                </ul>
              )
            ) : (
              <p className="py-6 text-muted">
                {section === "nunca" ? "Nenhum jogo parado na estante com esses filtros." : "Nenhum jogo com esses filtros."}
              </p>
            )}
            <Pagination basePath={base} params={kept} window={list} noun={["jogo", "jogos"]} label="Páginas da biblioteca" />
          </section>
        </>
      )}
    </div>
  );
}
