import Link from "next/link";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { GameCover } from "@/components/games/GameCover";
import { Chip } from "@/components/ui/Chip";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { LibraryGame } from "@/lib/library/queries";
import { formatPlaytime } from "@/lib/profile/library-view";
import { formatDate } from "./format";

/** One game of a player's library: cover, platforms, hours, achievements and last played. */
export function LibraryGameRow({ game }: { game: LibraryGame }) {
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-line py-3.5 min-[641px]:grid-cols-[52px_minmax(0,1fr)_110px_200px]">
      <div className="w-[52px]">
        {game.coverUrl ? (
          <GameCover name={game.name} coverUrl={game.coverUrl} ratio="3 / 4" lazy />
        ) : (
          // The name is right beside it: a plain decorative box (the labelled placeholder is too big here).
          <div aria-hidden="true" className="aspect-[3/4] rounded-[3px]" style={{ backgroundImage: "var(--stripes)" }} />
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-[16px] leading-tight font-extrabold font-stretch-[105%]">
          <Link href={`/jogos/${game.slug}`} className="hover:text-acc">
            {game.name}
          </Link>
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {game.platforms.map((p) => (
            <Chip key={p.platform} color={PLATFORM_TOKEN[p.platform]}>
              {PLATFORM_LABEL[p.platform]}
            </Chip>
          ))}
          {game.stub ? <Chip plain>Detalhes em breve</Chip> : null}
          {game.completed ? <Chip color="var(--acc)">100%</Chip> : null}
        </div>
        <p className="mt-1.5 font-mono text-xs text-dim">
          {game.lastPlayedAt ? `Jogado em ${formatDate(game.lastPlayedAt)}` : game.played ? "Data não informada" : "Nunca jogado"}
        </p>
      </div>
      <p className="col-start-2 font-mono text-xs text-dim min-[641px]:col-start-auto min-[641px]:text-right">
        <span className="sr-only">Horas jogadas: </span>
        <b className="text-[15px] text-text">{formatPlaytime(game.playtimeMin)}</b>
      </p>
      <div className="col-start-2 min-[641px]:col-start-auto">
        {game.achievementTotal > 0 ? (
          <>
            <p className="mb-1.5 flex justify-between font-mono text-xs text-dim">
              <span>
                <b className="text-text">{game.unlockedCount}</b> / {game.achievementTotal} conquistas
              </span>
              <b className="text-text">{game.completionPct ?? 0}%</b>
            </p>
            <ProgressBar value={game.completionPct ?? 0} label={`Conquistas de ${game.name}`} />
          </>
        ) : (
          <p className="font-mono text-xs text-dim">Sem conquistas</p>
        )}
      </div>
    </li>
  );
}
