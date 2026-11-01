import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { Ring } from "@/components/ui/Ring";
import { SKILLS } from "@/lib/engine/types";
import type { GameCard } from "@/lib/queries/games";
import { GameCover } from "./GameCover";

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

export function GameTile({ game }: { game: GameCard }) {
  const { unlockedCount, achievementCount } = game;
  const pct =
    unlockedCount === null || achievementCount === 0
      ? null
      : Math.round((unlockedCount / achievementCount) * 100);
  const platinum = unlockedCount !== null && unlockedCount === achievementCount;

  return (
    <Link
      href={`/jogos/${game.slug}`}
      className="flex flex-col overflow-hidden rounded-[4px] border border-line bg-surface transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_0_0_1px_var(--acc)]"
    >
      <div className="relative [&>*]:rounded-none">
        <GameCover name={game.name} coverUrl={game.coverUrl} lazy />
        {platinum ? (
          <span className="absolute top-2.5 right-2.5 bg-acc px-2 py-1 font-mono text-[10px] font-bold tracking-[0.12em] text-bg">
            PLATINADO
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-4 pt-3.5 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {game.skills.map((skill) => (
            <Chip key={skill} plain>
              {SKILL_NAME[skill]}
            </Chip>
          ))}
          {game.hasGuide ? <Chip color="var(--acc)">Guia completo</Chip> : null}
          {game.stub ? <Chip plain>Detalhes em breve</Chip> : null}
        </div>
        <h3 className="text-[19px] leading-[1.15] font-extrabold font-stretch-[105%] tracking-[-0.015em]">
          {game.name}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2.5 font-mono text-[11px] text-dim">
          {game.stub ? (
            <span>Do catálogo completo</span>
          ) : unlockedCount === null ? (
            <span>
              <b className="text-text">{achievementCount}</b> conquistas
            </span>
          ) : (
            <span>
              <b className="text-text">{unlockedCount}</b> / {achievementCount} conquistas
            </span>
          )}
          {pct !== null ? <Ring value={pct} /> : null}
        </div>
      </div>
    </Link>
  );
}
