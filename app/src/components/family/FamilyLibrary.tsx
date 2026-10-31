"use client";

import { useState } from "react";
import { FilterChips, type FilterOption } from "@/components/ui/FilterChips";
import type { FamilyLibraryEntry } from "@/lib/family/service";
import { FamilyGameTile } from "./FamilyGameTile";

type LibraryFilter = "todos" | "quem-tem" | "ninguem";

const OPTIONS: FilterOption[] = [
  { id: "todos", label: "Todos" },
  { id: "quem-tem", label: "Quem tem" },
  { id: "ninguem", label: "Ninguém jogou ainda" },
];

const HINTS: Record<LibraryFilter, string> = {
  todos: "Todos os jogos de todos os membros, sem repetir.",
  "quem-tem": "Jogos que mais de um membro tem. Dá para jogar junto.",
  ninguem: "Jogos que alguém tem, mas ninguém da família desbloqueou uma conquista.",
};

function matches(entry: FamilyLibraryEntry, filter: LibraryFilter): boolean {
  if (filter === "quem-tem") return entry.owners.length > 1;
  if (filter === "ninguem") return entry.bestProgress.unlocked === 0;
  return true;
}

export function FamilyLibrary({ entries }: { entries: FamilyLibraryEntry[] }) {
  const [filter, setFilter] = useState<LibraryFilter>("todos");
  const list = entries.filter((entry) => matches(entry, filter));

  return (
    <div className="flex flex-col gap-3 pt-5">
      <FilterChips
        options={OPTIONS}
        value={filter}
        onChange={(id) => setFilter(id as LibraryFilter)}
        ariaLabel="Filtrar a biblioteca da família"
      />
      <p className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase" aria-live="polite">
        {list.length} {list.length === 1 ? "jogo" : "jogos"}. {HINTS[filter]}
      </p>
      {list.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
          {list.map((entry) => (
            <FamilyGameTile key={entry.game.id} entry={entry} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-muted">
          {entries.length === 0
            ? "Nenhum jogo ainda. Os jogos aparecem quando os membros têm o perfil público e sincronizam a biblioteca."
            : "Nenhum jogo com esse filtro. Escolha outro."}
        </p>
      )}
    </div>
  );
}
