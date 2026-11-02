import { LinkChips } from "@/components/ui/LinkChips";
import { ListSearch } from "@/components/ui/ListSearch";
import { Pagination } from "@/components/ui/Pagination";
import {
  FAMILY_SORTS,
  filterFamilyLibrary,
  OWNERSHIP_FILTERS,
  sortFamilyLibrary,
  type FamilySort,
  type OwnershipFilter,
} from "@/lib/family/library-view";
import type { FamilyLibraryView } from "@/lib/family/service";
import {
  hrefWith,
  PAGE_PARAM,
  paginate,
  parsePagination,
  perPageParam,
  pickParams,
  type SearchParamsRecord,
} from "@/lib/pagination";
import { cleanQuery } from "@/lib/search/fold";
import { FamilyGameTile } from "./FamilyGameTile";

const BASE = "/familia";
/** Id of the library section on /familia (app/familia/page.tsx). */
const ANCHOR = "biblioteca";
const KEYS = ["q", "membro", "posse", "ordem", "por", PAGE_PARAM] as const;

const OWNERSHIP_LABEL: Record<OwnershipFilter, string> = {
  todos: "Todos",
  "todos-tem": "Todos têm",
  varios: "Mais de um tem",
  "so-um": "Só um tem",
  ninguem: "Ninguém jogou",
};
const OWNERSHIP_HINT: Record<OwnershipFilter, string> = {
  todos: "Todos os jogos de todos os integrantes, sem repetir.",
  "todos-tem": "Jogos que todos os integrantes com perfil público têm.",
  varios: "Jogos que mais de um integrante tem. Dá para jogar junto.",
  "so-um": "Jogos que só um integrante tem.",
  ninguem: "Jogos que alguém tem, mas ninguém da família jogou ainda.",
};
const SORT_LABEL: Record<FamilySort, string> = { nome: "Nome", horas: "Horas", donos: "Mais donos", progresso: "Progresso" };

/** The family's joint library: search, filters and numbered pages, all in the URL (works without JS). */
export function FamilyLibrary({ view, searchParams }: { view: FamilyLibraryView; searchParams: SearchParamsRecord }) {
  const state = pickParams(searchParams, KEYS);
  const sharing = view.members.filter((m) => m.profilePublic && m.gamesOwned > 0);
  const member = sharing.find((m) => m.handle === state.membro)?.handle;
  const ownership = (OWNERSHIP_FILTERS as readonly string[]).includes(state.posse ?? "") ? (state.posse as OwnershipFilter) : "todos";
  const sort = (FAMILY_SORTS as readonly string[]).includes(state.ordem ?? "") ? (state.ordem as FamilySort) : "nome";
  const q = cleanQuery(state.q);
  const { page, perPage } = parsePagination(searchParams);

  const kept: Record<string, string | undefined> = {
    q,
    membro: member,
    posse: ownership === "todos" ? undefined : ownership,
    ordem: sort === "nome" ? undefined : sort,
    por: perPageParam(perPage),
  };
  // The library sits below the family summary: filter links land on it.
  const link = (changes: Record<string, string | undefined>) =>
    `${hrefWith(BASE, kept, { ...changes, [PAGE_PARAM]: undefined })}#${ANCHOR}`;

  const filtered = filterFamilyLibrary(view.entries, { ownership, member, q, sharingMembers: sharing.length });
  const list = paginate(sortFamilyLibrary(filtered, sort), page, perPage);

  if (view.entries.length === 0) {
    return (
      <p className="py-6 text-muted">
        Nenhum jogo ainda. Os jogos aparecem quando os integrantes têm o perfil público e sincronizam a biblioteca.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-5">
      <ListSearch
        basePath={BASE}
        params={kept}
        q={q}
        label="Buscar na biblioteca da família"
        placeholder="Nome do jogo"
        anchor={ANCHOR}
      />
      <LinkChips
        label="Quem tem"
        caption="Quem tem"
        options={OWNERSHIP_FILTERS.map((o) => ({
          id: o,
          label: OWNERSHIP_LABEL[o],
          href: link({ posse: o === "todos" ? undefined : o }),
        }))}
        current={ownership}
      />
      {sharing.length > 1 ? (
        <LinkChips
          label="Filtrar por integrante"
          caption="Integrante"
          options={[
            { id: "todos", label: "Todos", href: link({ membro: undefined }) },
            ...sharing.map((m) => ({ id: m.handle, label: `@${m.handle}`, count: m.gamesOwned, href: link({ membro: m.handle }) })),
          ]}
          current={member ?? "todos"}
        />
      ) : null}
      <LinkChips
        label="Ordenar a biblioteca"
        caption="Ordenar"
        options={FAMILY_SORTS.map((s) => ({ id: s, label: SORT_LABEL[s], href: link({ ordem: s === "nome" ? undefined : s }) }))}
        current={sort}
      />
      <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase" aria-live="polite">
        {list.total.toLocaleString("pt-BR")} {list.total === 1 ? "jogo" : "jogos"}
        {q ? ` para “${q}”` : ""}. {OWNERSHIP_HINT[ownership]}
      </p>
      {list.items.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
          {list.items.map((entry) => (
            <FamilyGameTile key={entry.game.id} entry={entry} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-muted">Nenhum jogo com esses filtros. Escolha outro.</p>
      )}
      <Pagination basePath={BASE} params={kept} window={list} noun={["jogo", "jogos"]} label="Páginas da biblioteca da família" anchor={ANCHOR} />
    </div>
  );
}
