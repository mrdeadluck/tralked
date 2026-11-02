import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { loginHref } from "@/components/guide/format";
import { GAME_MENU_OPTIONS } from "@/components/layout/game-menu";
import { CaseItem, CaseShelf } from "@/components/shelf/CaseShelf";
import { LinkChips } from "@/components/ui/LinkChips";
import { ListSearch } from "@/components/ui/ListSearch";
import { Pagination } from "@/components/ui/Pagination";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import { genreName, primaryGenre } from "@/lib/engine/genres";
import { SKILLS, type SkillId } from "@/lib/engine/types";
import { hrefWith, PAGE_PARAM, parsePagination, perPageParam, pickParams } from "@/lib/pagination";
import {
  CATALOG_PLATFORMS,
  CATALOG_SORTS,
  countGames,
  listGames,
  type CatalogSort,
  type GameCard,
  type GameFilter,
} from "@/lib/queries/games";
import { cleanQuery } from "@/lib/search/fold";

export const metadata: Metadata = {
  title: "Jogos e guias | Tralked",
  description: "Catálogo de jogos com conquistas, guias 100% e o seu progresso em cada um.",
};

const BASE = "/jogos";
/** URL state of the catalog (`pagina` included: links built from it reset or set it). */
const KEYS = ["q", "plataforma", "genero", "quase", "guia", "ordem", "por", PAGE_PARAM] as const;

const PLATFORMS = new Set<string>(CATALOG_PLATFORMS);
const PLATFORM_OPTION = new Map(
  GAME_MENU_OPTIONS.map((o) => [new URL(o.href, "http://x").searchParams.get("plataforma") ?? "", o]),
);
const CATALOG_SKILLS = SKILLS.filter((s) => s.id !== "sabio");
const SORT_LABEL: Record<CatalogSort, string> = { popular: "Popular", nome: "Nome", lancamento: "Lançamento" };

export default function JogosPage({ searchParams }: PageProps<"/jogos">) {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <Catalog searchParams={searchParams} />
    </Suspense>
  );
}

async function Catalog({ searchParams }: Pick<PageProps<"/jogos">, "searchParams">) {
  const params = await searchParams;
  const user = await getSessionUser();
  const state = pickParams(params, KEYS);

  const skill = CATALOG_SKILLS.find((s) => s.id === state.genero)?.id as SkillId | undefined;
  const almost = state.quase === "1";
  const withGuide = state.guia === "1";
  const q = cleanQuery(state.q);
  const plataforma = state.plataforma?.toUpperCase();
  const platform = plataforma && PLATFORMS.has(plataforma) ? plataforma : undefined;
  const sort = (CATALOG_SORTS as readonly string[]).includes(state.ordem ?? "") ? (state.ordem as CatalogSort) : "popular";
  const { page: requested, perPage } = parsePagination(params);

  // Canonical state: only valid values travel in the links.
  const kept: Record<string, string | undefined> = {
    q,
    plataforma: platform,
    genero: skill,
    quase: almost ? "1" : undefined,
    guia: withGuide ? "1" : undefined,
    ordem: sort === "popular" ? undefined : sort,
    por: perPageParam(perPage),
  };
  const link = (changes: Record<string, string | undefined>) => hrefWith(BASE, kept, { ...changes, [PAGE_PARAM]: undefined });

  const filter: GameFilter = { skill, almost, withGuide, q, platform };
  const [result, catalogSize] = await Promise.all([
    listGames(filter, { page: requested, perPage, sort }, user?.id),
    countGames(),
  ]);

  const category = almost ? "quase" : withGuide ? "guia" : (skill ?? "todos");
  const noFilter = { quase: undefined, guia: undefined, genero: undefined };
  const categoryChips = [
    { id: "todos", label: "Todos", href: link(noFilter) },
    { id: "quase", label: "Quase 100%", href: link({ ...noFilter, quase: "1" }) },
    { id: "guia", label: "Com guia completo", href: link({ ...noFilter, guia: "1" }) },
    ...CATALOG_SKILLS.map((s) => ({ id: s.id, label: s.name, href: link({ ...noFilter, genero: s.id }) })),
  ];
  const platformChips = [
    { id: "todas", label: "Todas", href: link({ plataforma: undefined }) },
    ...CATALOG_PLATFORMS.map((p) => ({
      id: p,
      label: PLATFORM_OPTION.get(p)?.label ?? p,
      color: PLATFORM_OPTION.get(p)?.color,
      href: link({ plataforma: p }),
    })),
  ];
  const sortChips = CATALOG_SORTS.map((s) => ({
    id: s,
    label: SORT_LABEL[s],
    href: link({ ordem: s === "popular" ? undefined : s }),
  }));

  const { items, total } = result;

  return (
    <>
      <SectionHead
        title="Jogos e guias"
        aside={
          <span className="tracking-normal text-dim normal-case">
            {catalogSize.toLocaleString("pt-BR")} {catalogSize === 1 ? "jogo" : "jogos"} no catálogo
          </span>
        }
      />
      <div className="flex flex-col gap-4 pt-5 pb-6">
        <ListSearch
          basePath={BASE}
          params={kept}
          q={q}
          label="Buscar jogo pelo nome"
          placeholder="Ex.: hollow knight, pokémon, baldur's gate"
        />
        <LinkChips label="Filtrar jogos" options={categoryChips} current={category} />
        <LinkChips label="Filtrar por plataforma" caption="Plataforma" options={platformChips} current={platform ?? "todas"} />
        <LinkChips label="Ordenar jogos" caption="Ordenar" options={sortChips} current={sort} />
      </div>

      <p className="mb-3.5 font-mono text-xs tracking-[0.06em] text-dim" aria-live="polite">
        {total.toLocaleString("pt-BR")} {total === 1 ? "JOGO" : "JOGOS"}
        {q ? ` PARA “${q.toUpperCase()}”` : ""}
      </p>

      {items.length > 0 ? (
        <>
          <CaseShelf label="Jogos">
            {items.map((game) => (
              <GameCase key={game.id} game={game} />
            ))}
          </CaseShelf>
          <Pagination
            basePath={BASE}
            params={kept}
            window={{ page: result.page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) }}
            noun={["jogo", "jogos"]}
            label="Páginas do catálogo"
          />
        </>
      ) : almost && !user ? (
        <p className="py-10 text-[15px] text-muted">
          <a href={loginHref("/jogos?quase=1")} className="text-acc underline underline-offset-2">
            Entre
          </a>{" "}
          para ver os jogos em que você está perto do 100%.
        </p>
      ) : (
        <p className="py-10 text-[15px] text-muted">
          {q ? `Nenhum jogo encontrado para “${q}” com esses filtros.` : "Nenhum jogo com esse filtro."}{" "}
          <Link href={BASE} className="text-acc underline underline-offset-2">
            Ver todos os jogos
          </Link>
          .
        </p>
      )}
    </>
  );
}

/** One game on the shelf: its case (with the visitor's progress) and a two-line caption. */
function GameCase({ game }: { game: GameCard }) {
  const { unlockedCount, achievementCount } = game;
  const owned = unlockedCount !== null && achievementCount > 0;
  const pct = owned ? Math.round((unlockedCount / achievementCount) * 100) : null;
  // The game's genre (most specific first; a game mode such as Co-op is no genre).
  const primary = primaryGenre(game.skills);
  const genre = primary ? genreName(primary) : null;
  return (
    <CaseItem
      href={`/jogos/${game.slug}`}
      slug={game.slug}
      name={game.name}
      art={game.art}
      flag={owned && unlockedCount === achievementCount ? "PLATINADO" : undefined}
      progress={pct}
    >
      <h3 className="cs-name">{game.name}</h3>
      <span className="cs-meta">
        {game.stub ? (
          <span>na loja Steam</span>
        ) : owned ? (
          <span>
            <b>{unlockedCount}</b>/{achievementCount} · <span className="acc">{pct}%</span>
          </span>
        ) : (
          <span>
            {genre}
            {genre && achievementCount > 0 ? " · " : null}
            {achievementCount > 0 ? (
              <>
                <b>{achievementCount.toLocaleString("pt-BR")}</b> {achievementCount === 1 ? "conquista" : "conquistas"}
              </>
            ) : null}
          </span>
        )}
        {game.hasGuide ? <span className="acc">guia completo</span> : null}
      </span>
    </CaseItem>
  );
}
