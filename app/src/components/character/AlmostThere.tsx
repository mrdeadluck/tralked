import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import { GameCover } from "@/components/games/GameCover";
import type { CharacterAlmostGame } from "@/lib/queries/players";
import { Panel, PANEL_LINK } from "./Panel";

type AlmostThereProps = { games: CharacterAlmostGame[] };

/** "Quase lá": jogos com 70% ou mais das conquistas, ainda sem platina. */
export function AlmostThere({ games }: AlmostThereProps) {
  return (
    <Panel
      title="Quase lá"
      aside={
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>Jogos com 70% ou mais, ainda sem os 100%</span>
          <Link href="/jogos" className={PANEL_LINK}>
            Ver jogos
          </Link>
        </span>
      }
    >
      {games.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhum jogo na reta final. Jogos com 70% ou mais das conquistas aparecem aqui.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 p-0">
          {games.map((game) => {
            const lit = Math.floor(game.percent / 10);
            return (
              <li key={game.slug}>
                <Link
                  href={`/jogos/${game.slug}`}
                  className="group flex h-full flex-col bg-surface-2 transition-colors duration-150 hover:bg-hover-2"
                >
                  <span className="relative block">
                    <GameCover
                      name={game.name}
                      coverUrl={game.coverUrl}
                      steamAppId={game.steamAppId}
                      wideUrl={game.heroUrl}
                      art={game.art}
                      ratio="16 / 10"
                      alt=""
                      className="rounded-none"
                      width={400}
                      sizes="(max-width: 640px) calc(100vw - 40px), 400px"
                    />
                    <span className="absolute top-0 right-0 bg-acc py-[5px] pr-[9px] pl-3 text-[17px] leading-none font-black font-stretch-[112%] text-acc-ink tabular-nums [clip-path:polygon(8px_0,100%_0,100%_100%,0_100%,0_8px)]">
                      {game.percent}%
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col gap-1.5 px-3 pt-2.5 pb-3">
                    {game.skills.length > 0 || game.hasGuide ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {game.skills.map((skill) => (
                          <Chip key={skill} plain>
                            {skill}
                          </Chip>
                        ))}
                        {game.hasGuide ? <Chip color="var(--acc)">Guia completo</Chip> : null}
                      </span>
                    ) : null}
                    <strong className="text-[15px] leading-tight font-extrabold group-hover:text-acc">{game.name}</strong>
                    <span className="mt-auto flex justify-between gap-2 text-[12.5px] text-muted tabular-nums">
                      <span>
                        <b className="text-text">{game.unlocked}</b> / {game.total}{" "}
                        {game.total === 1 ? "conquista" : "conquistas"}
                      </span>
                      <span>
                        faltam <b className="text-text">{game.total - game.unlocked}</b>
                      </span>
                    </span>
                    <span aria-hidden="true" className="flex gap-0.5">
                      {Array.from({ length: 10 }, (_, i) => (
                        <i key={i} className={`h-[5px] flex-1 ${i < lit ? "bg-acc-dim" : "bg-bg"}`} />
                      ))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
