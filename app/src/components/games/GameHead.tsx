import Link from "next/link";
import { timeAgo } from "@/components/guide/format";
import { Chip } from "@/components/ui/Chip";
import { PLATFORM_COLOR, type Platform } from "@/components/ui/PlatformChips";
import { Ring } from "@/components/ui/Ring";
import { SKILLS } from "@/lib/engine/types";
import type { GameDetail } from "@/lib/queries/games";
import { GameCover } from "./GameCover";

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

function isPlatform(value: string): value is Platform {
  return value in PLATFORM_COLOR;
}

export function GameHead({ game }: { game: GameDetail }) {
  const { progress, guide } = game;
  const pct =
    progress && game.achievementCount > 0
      ? Math.round((progress.unlockedCount / game.achievementCount) * 100)
      : null;

  return (
    <>
      {guide ? (
        // Plan 4 F12: Jogos › <Jogo> › Guia.
        <nav aria-label="Você está em" className="mb-[18px] font-mono text-[11px] tracking-[0.1em] text-dim uppercase">
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0">
            <li>
              <Link href="/jogos" className="hover:text-acc">
                Jogos
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li className="min-w-0">
              <Link href={`/jogos/${game.slug}`} className="hover:text-acc">
                {game.name}
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li>
              <span aria-current="page" className="text-text-2">
                Guia
              </span>
            </li>
          </ol>
        </nav>
      ) : (
        <Link
          href="/jogos"
          className="mb-[18px] inline-flex font-mono text-[11px] tracking-[0.1em] text-dim uppercase hover:text-acc"
        >
          ← Jogos e guias
        </Link>
      )}
      <div className="grid items-center gap-7 border-b-2 border-text pb-7 grid-cols-[minmax(0,360px)_minmax(0,1fr)_auto] max-[900px]:grid-cols-[1fr_auto]">
        <div className="max-[900px]:col-span-full">
          <GameCover name={game.name} coverUrl={game.coverUrl} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] uppercase">
            <span className="mr-1.5 text-acc">{guide ? "GUIA 100%" : "JOGO"}</span>
            {game.platforms.filter(isPlatform).map((platform) => (
              <Chip key={platform} color={PLATFORM_COLOR[platform]}>
                {platform}
              </Chip>
            ))}
            {game.skills.map((skill) => (
              <Chip key={skill} plain>
                Treina {SKILL_NAME[skill]}
              </Chip>
            ))}
          </div>
          <h1 className="mt-3 mb-2.5 text-[clamp(32px,4.2vw,56px)] leading-[0.98] font-black font-stretch-[112%] tracking-[-0.035em]">
            {game.name}
          </h1>
          {guide ? (
            <>
              <p className="mb-3.5 text-[17px] text-text-3">
                Guia completo de conquistas: rota em {guide.stepCount} etapas, conquistas detalhadas e
                coletáveis.
              </p>
              <Link
                href={`/jogos/${game.slug}`}
                aria-label={`Página do jogo: ${game.name}`}
                className="mb-3.5 inline-flex min-h-6 items-center gap-1.5 font-mono text-[11.5px] tracking-[0.08em] text-acc uppercase underline-offset-[3px] hover:underline"
              >
                Página do jogo →
              </Link>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-dim">
                {guide.authorHandle ? <span className="text-text-2">@{guide.authorHandle}</span> : null}
                <span>atualizado {timeAgo(guide.updatedAt, game.generatedAt)}</span>
                <span>{guide.version}</span>
                {guide.reviewers.length > 0 ? (
                  <span>revisado por {guide.reviewers.map((h) => `@${h}`).join(", ")}</span>
                ) : null}
                <span className="inline-flex items-center gap-1.5 text-acc before:size-1.5 before:rounded-full before:bg-acc before:content-['']">
                  Autoria humana
                </span>
              </div>
            </>
          ) : progress ? (
            <p className="text-[17px] text-text-3">
              <b className="text-text">{progress.unlockedCount}</b> de {game.achievementCount}{" "}
              conquistas desbloqueadas
            </p>
          ) : (
            <p className="text-[17px] text-text-3">{game.achievementCount} conquistas na Steam</p>
          )}
        </div>
        {pct !== null ? <Ring value={pct} size={120} /> : null}
      </div>
    </>
  );
}
