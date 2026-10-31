import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { HighscoreSkillSelect } from "@/components/character/HighscoreSkillSelect";
import { SectionHead } from "@/components/ui/SectionHead";
import { getSessionUser } from "@/lib/auth/session";
import { SKILLS } from "@/lib/engine/types";
import {
  getHighscores,
  getUserRank,
  isHighscoreSkill,
  type HighscoreRow,
  type HighscoreSkill,
} from "@/lib/queries/players";

export default function HighscoresPage({ searchParams }: PageProps<"/highscores">) {
  return (
    <div className="flex flex-col">
      <SectionHead
        title="Highscores"
        aside={<span className="text-dim normal-case tracking-normal">Os melhores de cada gênero.</span>}
      />
      <Suspense
        fallback={
          <div
            aria-busy="true"
            aria-label="Carregando ranking"
            className="mt-6 h-[480px] animate-pulse rounded-[4px] border border-line bg-surface"
          />
        }
      >
        <Ranking searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Ranking({ searchParams }: { searchParams: PageProps<"/highscores">["searchParams"] }) {
  const { skill: raw } = await searchParams;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const skill: HighscoreSkill = requested && isHighscoreSkill(requested) ? requested : "geral";

  const viewer = await getSessionUser();
  const [rows, ownRow] = await Promise.all([
    getHighscores(skill, 50),
    viewer ? getUserRank(viewer.id, skill) : Promise.resolve(null),
  ]);

  const ownInTop = viewer ? rows.some((row) => row.handle === viewer.handle) : false;
  const skillName = SKILLS.find((s) => s.id === skill)?.name;
  const levelHeader = skill === "geral" ? "Nível" : `Nível em ${skillName}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 pt-4 pb-3">
        <HighscoreSkillSelect value={skill} />
        <div role="group" aria-label="Escopo" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed="true"
            className="h-[34px] cursor-default rounded-[2px] border border-text bg-text px-3 font-mono text-[11px] tracking-[0.08em] text-bg uppercase"
          >
            Global
          </button>
          <button
            type="button"
            aria-pressed="false"
            disabled
            className="h-[34px] rounded-[2px] border border-line-2 px-3 font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase disabled:cursor-not-allowed disabled:opacity-45"
          >
            Amigos (em breve)
          </button>
        </div>
      </div>

      {viewer && !viewer.profilePublic ? (
        <p className="pb-3 font-mono text-xs text-dim">
          Seu perfil está privado, por isso você não aparece no ranking.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted">Ninguém no ranking desta skill ainda.</p>
      ) : (
        <div role="region" tabIndex={0} aria-label="Tabela de ranking" className="overflow-x-auto">
          <table className="w-full border-collapse tabular-nums">
            <caption className="sr-only">Ranking de jogadores: {skill === "geral" ? "nível geral" : skillName}</caption>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Jogador</Th>
                <Th>Vocação</Th>
                <Th>{levelHeader}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RankRow key={row.handle} row={row} me={row.handle === viewer?.handle} />
              ))}
              {viewer && ownRow && !ownInTop ? (
                <>
                  <tr aria-hidden="true">
                    <td colSpan={4} className="border-b border-line px-3 py-1 text-center font-mono text-dim-2">
                      …
                    </td>
                  </tr>
                  <RankRow row={ownRow} me />
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="border-b border-line px-3 py-3.5 text-left font-mono text-[10.5px] font-normal tracking-[0.14em] whitespace-nowrap text-dim-2 uppercase"
    >
      {children}
    </th>
  );
}

function RankRow({ row, me }: { row: HighscoreRow; me: boolean }) {
  const position =
    row.rank === 1 ? "text-acc" : row.rank <= 3 ? "text-text" : "text-ph";
  return (
    <tr
      aria-current={me ? "true" : undefined}
      className={me ? "bg-acc/[0.07] shadow-[inset_3px_0_0_var(--acc)]" : undefined}
    >
      <td
        className={`w-14 border-b border-line px-3 py-3.5 text-xl font-black font-stretch-[125%] whitespace-nowrap ${position}`}
      >
        {row.rank}
      </td>
      <td className="border-b border-line px-3 py-3.5 whitespace-nowrap">
        <Link href={`/jogador/${encodeURIComponent(row.handle)}`} className="hover:text-acc">
          @{row.handle}
        </Link>
        {me ? <span className="text-dim"> (você)</span> : null}
      </td>
      <td className="border-b border-line px-3 py-3.5 font-mono text-xs whitespace-nowrap text-dim">
        {row.vocation}
      </td>
      <td className="border-b border-line px-3 py-3.5 text-xl font-black font-stretch-[125%] whitespace-nowrap">
        {row.level}
      </td>
    </tr>
  );
}
