import Link from "next/link";
import { GameCover } from "@/components/games/GameCover";
import { Chip } from "@/components/ui/Chip";
import { Ring } from "@/components/ui/Ring";
import type { FamilyLibraryEntry } from "@/lib/family/service";
import { formatPlaytime } from "@/lib/profile/library-view";

/** Game tile shared by the joint library and "Quase lá da família": who has it, hours, the best member. */
export function FamilyGameTile({ entry }: { entry: FamilyLibraryEntry }) {
  const { game, owners, bestProgress } = entry;
  return (
    <article className="flex flex-col overflow-hidden rounded-[4px] border border-line bg-surface">
      <div className="[&>*]:rounded-none">
        <GameCover name={game.name} coverUrl={game.coverUrl} lazy />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-4 pt-3.5 pb-4">
        <h3 className="text-[19px] leading-[1.15] font-extrabold font-stretch-[105%] tracking-[-0.015em]">
          <Link href={`/jogos/${game.slug}`} className="hover:text-acc">
            {game.name}
          </Link>
        </h3>
        {game.stub ? (
          <span>
            <Chip plain>Detalhes em breve</Chip>
          </span>
        ) : null}
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Quem tem este jogo">
          {owners.map((owner) => (
            <li key={owner.handle}>
              <Chip plain>
                @{owner.handle}
                {owner.playtimeMin > 0 ? <span className="text-dim"> · {formatPlaytime(owner.playtimeMin)}</span> : null}
              </Chip>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center justify-between gap-2.5 font-mono text-xs text-dim">
          <span>
            {bestProgress.total === 0 ? (
              "Sem conquistas"
            ) : bestProgress.unlocked <= 0 ? (
              "Ninguém desbloqueou ainda"
            ) : (
              <>
                <b className="text-text">@{bestProgress.handle}</b> lidera com{" "}
                <b className="text-text">{bestProgress.unlocked}</b> / {bestProgress.total}
              </>
            )}
          </span>
          {bestProgress.total > 0 ? <Ring value={bestProgress.pct} size={40} /> : null}
        </div>
      </div>
    </article>
  );
}
