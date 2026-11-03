import Link from "next/link";
import { formatAgo } from "@/components/character/format";
import { formatHours } from "@/components/profile/format";
import { GameCover } from "@/components/games/GameCover";
import type { RecentlyPlayedGame } from "@/lib/library/queries";
import { Panel, PANEL_LINK } from "./Panel";
import { PLATFORM_LABEL } from "./platforms";

type RecentlyPlayedProps = { games: RecentlyPlayedGame[]; now: Date; libraryHref: string };

/** "Jogou recentemente": os últimos jogos jogados, do mais recente para o mais antigo. */
export function RecentlyPlayed({ games, now, libraryHref }: RecentlyPlayedProps) {
  return (
    <Panel
      title="Jogou recentemente"
      aside={
        <Link href={libraryHref} className={PANEL_LINK}>
          Ver biblioteca
        </Link>
      }
    >
      {games.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma partida recente ainda. Os jogos aparecem aqui depois da próxima sincronização.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {games.map((game) => (
            <li key={game.slug}>
              <Link
                href={`/jogos/${game.slug}`}
                className="group grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 bg-surface-2 p-2 transition-colors duration-150 hover:bg-hover-2"
              >
                <GameCover
                  name={game.name}
                  coverUrl={game.coverUrl}
                  steamAppId={game.steamAppId}
                  wideUrl={game.heroUrl}
                  ratio="2 / 3"
                  alt=""
                  className="rounded-none"
                  width={44}
                  sizes="44px"
                />
                <span className="min-w-0">
                  <strong className="line-clamp-2 text-sm leading-tight font-bold group-hover:text-acc">{game.name}</strong>
                  <small className="text-[12.5px] text-muted">
                    {PLATFORM_LABEL[game.platform]} · {formatAgo(game.lastPlayedAt, now)}
                  </small>
                </span>
                {game.playtimeMin > 0 ? (
                  <span className="text-right text-sm font-extrabold whitespace-nowrap tabular-nums">
                    {formatHours(game.playtimeMin)}
                    <small className="block text-[12.5px] font-medium text-muted">jogadas</small>
                  </span>
                ) : (
                  <span />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
