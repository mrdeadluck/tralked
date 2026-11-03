import Link from "next/link";
import { Bar, TralkedStamp } from "@/components/character/Panel";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "@/components/character/platforms";
import { GameCover } from "@/components/games/GameCover";
import { Chip } from "@/components/ui/Chip";
import type { LibraryGame } from "@/lib/library/queries";
import { formatPlaytime } from "@/lib/profile/library-view";
import { formatDate } from "./format";

/**
 * One game of a player's library: cover, platforms, hours, achievements and last played. A 100%
 * game turns moss with the TRALKED! stamp and a lime bar.
 */
export function LibraryGameRow({ game }: { game: LibraryGame }) {
  const done = game.platforms.find((p) => p.completedAt !== null);
  const percent = game.completionPct ?? 0;
  return (
    <li
      className={`grid grid-cols-[52px_minmax(0,1fr)_76px] items-center gap-x-4 gap-y-2 py-2 pr-3.5 pl-2 transition-colors duration-150 min-[761px]:grid-cols-[64px_minmax(0,1.5fr)_120px_minmax(0,1.2fr)] ${
        game.completed ? "bg-[linear-gradient(90deg,var(--surface),var(--moss-2))]" : "bg-surface hover:bg-surface-2"
      }`}
    >
      <div className="w-[52px] min-[761px]:w-16">
        {game.coverUrl ? (
          <GameCover name={game.name} coverUrl={game.coverUrl} ratio="2 / 3" lazy width={64} sizes="64px" className="rounded-none" />
        ) : (
          // The name is right beside it: a plain decorative box (the labelled placeholder is too big here).
          <div aria-hidden="true" className="aspect-[2/3]" style={{ backgroundImage: "var(--stripes)" }} />
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-[15.5px] leading-tight font-bold">
          <Link href={`/jogos/${game.slug}`} className="hover:text-acc">
            {game.name}
          </Link>
        </h3>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {game.lastPlayedAt ? `Jogado em ${formatDate(game.lastPlayedAt)}` : game.played ? "Data não informada" : "Nunca jogado"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {game.platforms.map((p) => (
            <Chip key={p.platform} color={PLATFORM_TOKEN[p.platform]}>
              {PLATFORM_LABEL[p.platform]}
            </Chip>
          ))}
          {game.stub ? <Chip plain>Detalhes em breve</Chip> : null}
          {game.completed ? (
            <TralkedStamp unlocked={done?.unlockedCount} total={done?.achievementTotal} className="ml-1" />
          ) : null}
        </div>
      </div>
      <p className="text-right min-[761px]:text-left">
        <span className="sr-only">Horas jogadas: </span>
        <b className="block text-lg leading-tight font-extrabold font-stretch-[110%] tabular-nums">{formatPlaytime(game.playtimeMin)}</b>
        <small aria-hidden="true" className="text-xs text-muted">
          horas jogadas
        </small>
      </p>
      <div className="col-span-full min-[761px]:col-span-1">
        {game.achievementTotal > 0 ? (
          <div
            role="progressbar"
            aria-label={`Conquistas de ${game.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="flex flex-col gap-1.5"
          >
            <p className="flex items-center justify-between gap-2 text-[13.5px] text-text-2 tabular-nums">
              <span>
                <b className="text-text">{game.unlockedCount}</b> / {game.achievementTotal} conquistas
              </span>
              <b className="text-text">{percent}%</b>
            </p>
            <Bar fraction={percent / 100} hot={game.completed || percent >= 100} />
          </div>
        ) : (
          <p className="text-[13.5px] text-muted">Sem conquistas</p>
        )}
      </div>
    </li>
  );
}
