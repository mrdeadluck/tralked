import Link from "next/link";
import { SectionHead } from "@/components/ui/SectionHead";
import { RemoteImg } from "@/components/ui/RemoteImg";
import type { ShelfGame } from "@/lib/library/shelf";
import { ShelfSpines } from "./ShelfSpines";

type ShelfProps = { games: ShelfGame[]; libraryHref: string };

/**
 * "Estante": the player's most played games as boxes on a shelf, with three tiles that explain how
 * to read it (the spine is the game's art, the height is the hours, lime frame is a 100%).
 */
export function Shelf({ games, libraryHref }: ShelfProps) {
  const sample = games[0] ? (games[0].coverUrl ?? games[0].heroUrl) : null;
  return (
    <section aria-label="Estante" className="flex flex-col">
      <div className="mb-4">
        <SectionHead title="Estante" aside={<Link href={libraryHref}>Ver a biblioteca inteira</Link>} />
      </div>
      {games.length === 0 ? (
        <p className="bg-surface p-[18px] text-sm text-muted">
          A estante se monta com os jogos que têm horas registradas. Elas chegam na próxima sincronização.
        </p>
      ) : (
        <>
          <ul className="m-0 mb-0.5 grid list-none gap-0.5 p-0 min-[1101px]:grid-cols-3">
            <li className="flex items-center gap-3 bg-surface px-3.5 py-3 text-[13.5px] text-text-2">
              <span aria-hidden="true" className="relative h-10 w-[26px] flex-none overflow-hidden bg-track shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)]">
                {sample ? (
                  <RemoteImg url={sample} alt="" width={52} height={80} sizes="26px" shape="fit" className="size-full object-cover" />
                ) : null}
              </span>
              <span>
                <b className="block text-sm text-text">Cada caixa é um jogo seu</b>A lombada usa a arte do jogo. Passe o
                mouse ou toque para tirar a caixa da prateleira.
              </span>
            </li>
            <li className="flex items-center gap-3 bg-surface px-3.5 py-3 text-[13.5px] text-text-2">
              <span aria-hidden="true" className="h-10 w-[26px] flex-none bg-[linear-gradient(0deg,var(--bg)_0_24%,var(--border-2)_24%)]" />
              <span>
                <b className="block text-sm text-text">A altura é o tempo de jogo</b>Quanto mais horas, mais alta a caixa.
                O número embaixo é a % de conquistas.
              </span>
            </li>
            <li className="flex items-center gap-3 bg-surface px-3.5 py-3 text-[13.5px] text-text-2">
              <span aria-hidden="true" className="h-10 w-[26px] flex-none bg-[linear-gradient(0deg,var(--acc)_0_24%,var(--track)_24%)] shadow-[inset_0_0_0_2px_var(--acc)]" />
              <span>
                <b className="block text-sm text-text">Borda verde = TRALKED! (100%)</b>Os jogos que você fechou ficam
                marcados de verde na estante.
              </span>
            </li>
          </ul>
          <ShelfSpines games={games} />
          <div
            aria-hidden="true"
            className="h-3.5 bg-[linear-gradient(180deg,oklch(0.36_0.01_250),oklch(0.24_0.008_250))] shadow-[0_14px_22px_-12px_rgba(0,0,0,.9)]"
          />
        </>
      )}
    </section>
  );
}
