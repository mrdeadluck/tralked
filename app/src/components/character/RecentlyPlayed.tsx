import Link from "next/link";
import { formatAgo } from "@/components/character/format";
import { formatHours } from "@/components/profile/format";
import { Placeholder } from "@/components/ui/Placeholder";
import { SectionHead } from "@/components/ui/SectionHead";
import type { RecentlyPlayedGame } from "@/lib/library/queries";
import { PLATFORM_LABEL, PLATFORM_TOKEN } from "./platforms";

type RecentlyPlayedProps = { games: RecentlyPlayedGame[]; now: Date; libraryHref: string };

/** "Jogou recentemente": os últimos jogos jogados, do mais recente para o mais antigo. */
export function RecentlyPlayed({ games, now, libraryHref }: RecentlyPlayedProps) {
  return (
    <section className="flex min-w-0 flex-col">
      <SectionHead title="Jogou recentemente" aside={<Link href={libraryHref}>Ver biblioteca →</Link>} />
      {games.length === 0 ? (
        <p className="pt-5 text-sm text-muted">
          Nenhuma partida recente ainda. Os jogos aparecem aqui depois da próxima sincronização.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 p-0 pt-5">
          {games.map((game) => (
            <li key={game.slug}>
              <Link
                href={`/jogos/${game.slug}`}
                className="flex h-full flex-col overflow-hidden rounded-[4px] border border-line bg-surface hover:border-line-2"
              >
                {game.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- capa externa (Steam/IGDB/SteamGridDB)
                  <img src={game.coverUrl} alt={`Capa de ${game.name}`} className="aspect-[3/4] w-full object-cover" />
                ) : (
                  <div className="[&>div]:rounded-none">
                    <Placeholder label={`capa: ${game.name.toLowerCase()}`} />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-1 px-3 pt-2.5 pb-3">
                  <h3 className="line-clamp-2 text-[14px] leading-[1.2] font-bold">{game.name}</h3>
                  <p className="mt-auto font-mono text-xs text-dim">
                    <span style={{ color: PLATFORM_TOKEN[game.platform] }}>{PLATFORM_LABEL[game.platform]}</span>
                    {" · "}
                    {formatAgo(game.lastPlayedAt, now)}
                    {game.playtimeMin > 0 ? ` · ${formatHours(game.playtimeMin)}` : null}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
