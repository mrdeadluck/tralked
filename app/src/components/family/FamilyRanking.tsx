"use client";

import { useId, useState } from "react";
import { SKILLS } from "@/lib/engine/types";
import type { FamilyRankingRow } from "@/lib/family/service";

type RankingKey = string;

type FamilyRankingProps = {
  /** Precomputed rows per option: "geral" plus one entry per skill id. */
  rankings: Record<RankingKey, FamilyRankingRow[]>;
  /** Handle of the logged-in user, highlighted in the table. */
  meHandle: string;
};

const nf = new Intl.NumberFormat("pt-BR");

export function FamilyRanking({ rankings, meHandle }: FamilyRankingProps) {
  const [skill, setSkill] = useState<RankingKey>("geral");
  const selectId = useId();
  const rows = rankings[skill] ?? [];
  const skillName = SKILLS.find((s) => s.id === skill)?.name;

  return (
    <div className="flex flex-col pt-4">
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <label
          htmlFor={selectId}
          className="font-mono text-[11px] tracking-[0.14em] text-dim uppercase"
        >
          Skill
        </label>
        <select
          id={selectId}
          value={skill}
          onChange={(event) => setSkill(event.target.value)}
          className="h-[42px] rounded-[2px] border border-line-2 bg-surface-2 px-3 text-text"
        >
          <option value="geral">Nível geral</option>
          {SKILLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-muted">Ninguém com perfil público na família ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse tabular-nums">
            <thead>
              <tr className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase">
                <th scope="col" className="px-3 py-3.5 text-left font-normal">#</th>
                <th scope="col" className="px-3 py-3.5 text-left font-normal">Jogador</th>
                <th scope="col" className="px-3 py-3.5 text-left font-normal">Vocação</th>
                <th scope="col" className="px-3 py-3.5 text-left font-normal">
                  {skill === "geral" ? "Nível" : `Nível em ${skillName}`}
                </th>
                <th scope="col" className="px-3 py-3.5 text-left font-normal">
                  {skill === "geral" ? "XP" : "Pontos"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const me = row.handle === meHandle;
                return (
                  <tr
                    key={row.userId}
                    className={`border-b border-line ${me ? "bg-acc/[0.07] shadow-[inset_3px_0_0_var(--acc)]" : ""}`}
                  >
                    <td
                      className={`w-14 px-3 py-3.5 text-xl font-black font-stretch-[125%] whitespace-nowrap ${
                        index === 0 ? "text-acc" : index < 3 ? "text-text" : "text-ph"
                      }`}
                    >
                      {index + 1}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      @{row.handle}
                      {me ? " (você)" : ""}
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs whitespace-nowrap text-dim">
                      {row.vocation ?? "Recruta"}
                    </td>
                    <td className="px-3 py-3.5 text-xl font-black font-stretch-[125%] whitespace-nowrap">
                      {row.level}
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs whitespace-nowrap text-dim">
                      {nf.format(row.points)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
