"use client";

import { useState } from "react";
import { FilterChips } from "@/components/ui/FilterChips";
import { SectionHead } from "@/components/ui/SectionHead";
import type { GuideAchievementView } from "@/lib/queries/games";
import { AchievementItem } from "./AchievementItem";
import { CheckLabel } from "./CheckLabel";
import { ACHIEVEMENT_FILTERS } from "./format";

type AchievementListProps = {
  achievements: GuideAchievementView[];
  /** The game's full achievement count (Steam). */
  totalCount: number;
};

export function AchievementList({ achievements, totalCount }: AchievementListProps) {
  const [filter, setFilter] = useState("todas");
  const [showSpoilers, setShowSpoilers] = useState(false);

  const visible = achievements.filter((a) =>
    filter === "todas" ? true : filter === "pendentes" ? !a.done : a.category === filter,
  );

  return (
    <section id="g-conq" data-sec className="scroll-mt-24">
      <SectionHead
        title="Conquistas"
        aside={
          <span className="tracking-normal text-dim normal-case" aria-live="polite">
            Mostrando {visible.length} de {totalCount} neste guia
          </span>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 pb-1.5">
        <FilterChips
          ariaLabel="Filtrar conquistas"
          options={ACHIEVEMENT_FILTERS}
          value={filter}
          onChange={setFilter}
        />
        <CheckLabel checked={showSpoilers} onChange={(e) => setShowSpoilers(e.target.checked)}>
          Mostrar spoilers
        </CheckLabel>
      </div>
      {visible.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {visible.map((a) => (
            <AchievementItem key={a.id} achievement={a} showSpoilers={showSpoilers} />
          ))}
        </ul>
      ) : (
        <p className="py-10 text-[15px] text-[#8A8D96]">Nenhuma conquista nesse filtro.</p>
      )}
    </section>
  );
}
