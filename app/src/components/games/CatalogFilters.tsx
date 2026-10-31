"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilterChips, type FilterOption } from "@/components/ui/FilterChips";

export type CatalogFilterId = "todos" | "quase" | "guia" | (string & {});

type CatalogFiltersProps = {
  /** Currently selected chip: "todos", "quase", "guia" or a skill id. */
  current: CatalogFilterId;
  options: FilterOption[];
  /** Extra URL filters that stay while the chip changes. */
  q?: string;
  platform?: string;
};

function hrefFor(id: CatalogFilterId, q?: string, platform?: string): string {
  const params = new URLSearchParams();
  if (id === "quase") params.set("quase", "1");
  else if (id === "guia") params.set("guia", "1");
  else if (id !== "todos") params.set("genero", id);
  if (q) params.set("q", q);
  if (platform) params.set("plataforma", platform);
  const query = params.toString();
  return query ? `/jogos?${query}` : "/jogos";
}

/** Filters live in the URL so a filtered catalog can be linked and bookmarked. */
export function CatalogFilters({ current, options, q, platform }: CatalogFiltersProps) {
  const router = useRouter();
  const pill =
    "inline-flex h-[34px] items-center gap-2 rounded-[2px] border border-acc px-3 font-mono text-[11px] tracking-[0.08em] text-acc uppercase hover:bg-acc hover:text-bg";

  return (
    <div className="flex flex-col gap-3">
      <FilterChips
        ariaLabel="Filtrar jogos"
        options={options}
        value={current}
        onChange={(id) => router.push(hrefFor(id, q, platform), { scroll: false })}
      />
      {platform || q ? (
        <div className="flex flex-wrap gap-1.5">
          {platform ? (
            <Link href={hrefFor(current, q, undefined)} className={pill}>
              Plataforma: {platform} ✕
            </Link>
          ) : null}
          {q ? (
            <Link href={hrefFor(current, undefined, platform)} className={pill}>
              Busca: {q} ✕
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
