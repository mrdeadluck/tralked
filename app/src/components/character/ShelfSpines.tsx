"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { formatHours } from "@/components/profile/format";
import { RemoteImg } from "@/components/ui/RemoteImg";
import type { ShelfGame } from "@/lib/library/shelf";
import { TralkedStamp } from "./Panel";

const CARD_W = 290;

const percentOf = (g: ShelfGame) => (g.total > 0 ? Math.min(100, Math.floor((g.unlocked / g.total) * 100)) : null);
const isFull = (g: ShelfGame) => g.completed || (g.total > 0 && g.unlocked >= g.total);

/**
 * The shelf itself: one spine per game, as tall as its hours, with the achievements % at the foot
 * and a lime frame for a 100%. Pointing at a spine (or focusing it) lifts it and shows a small
 * card; on touch, the first tap shows the card and the second opens the game. Each spine is a link
 * to the game page whose name carries everything the card says.
 */
export function ShelfSpines({ games }: { games: ShelfGame[] }) {
  const box = useRef<HTMLDivElement>(null);
  const touch = useRef(false);
  const [open, setOpen] = useState<{ index: number; left: number } | null>(null);
  const most = Math.max(1, ...games.map((g) => g.playtimeMin));

  const show = (index: number, el: HTMLElement) => {
    const frame = box.current?.getBoundingClientRect();
    if (!frame) return;
    const spine = el.getBoundingClientRect();
    let left = spine.right - frame.left + 12;
    if (left + CARD_W > frame.width - 8) left = spine.left - frame.left - CARD_W - 12;
    setOpen({ index, left: Math.max(8, Math.min(left, frame.width - CARD_W - 8)) });
  };

  const game = open ? games[open.index] : null;
  const pct = game ? percentOf(game) : null;

  return (
    <div
      ref={box}
      className="relative flex min-h-[340px] items-end bg-[linear-gradient(180deg,var(--surface),var(--surface-2))] px-[18px]"
      onMouseLeave={() => setOpen(null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(null);
      }}
    >
      <ul className="m-0 flex min-w-0 flex-1 list-none items-end gap-[5px] overflow-x-auto p-0 pt-10">
        {games.map((g, index) => {
          const p = percentOf(g);
          const full = isFull(g);
          const art = g.coverUrl ?? g.heroUrl;
          const height = Math.round(150 + (g.playtimeMin / most) * 150);
          const label = `${g.name}, ${formatHours(g.playtimeMin)} jogadas${
            g.total > 0 ? `, ${g.unlocked} de ${g.total} conquistas (${p}%)` : ", sem conquistas"
          }${full ? ", TRALKED! 100%" : ""}`;
          return (
            <li key={g.slug} className="flex-none">
              <Link
                href={`/jogos/${g.slug}`}
                aria-label={label}
                onPointerDown={(event) => {
                  touch.current = event.pointerType === "touch";
                }}
                onMouseEnter={(event) => show(index, event.currentTarget)}
                onFocus={(event) => show(index, event.currentTarget)}
                onClick={(event) => {
                  // Touch: the first tap shows the card, the second one follows the link.
                  if (touch.current && open?.index !== index) {
                    event.preventDefault();
                    show(index, event.currentTarget);
                  }
                }}
                style={{ height } as CSSProperties}
                className={`relative block w-[46px] overflow-hidden bg-track transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-4 focus-visible:-translate-y-4 motion-reduce:transition-none ${
                  open?.index === index ? "-translate-y-4" : ""
                }`}
              >
                {art ? (
                  <RemoteImg
                    url={art}
                    alt=""
                    width={92}
                    height={300}
                    sizes="46px"
                    shape="fit"
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,12,16,.78),rgba(10,12,16,.5)_40%,rgba(10,12,16,.82))]"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-2 bottom-[30px] grid rotate-180 place-items-center overflow-hidden text-xs font-extrabold font-stretch-[85%] tracking-[0.03em] whitespace-nowrap text-white [text-shadow:0_1px_2px_#000] [writing-mode:vertical-rl]"
                >
                  {g.name}
                </span>
                <em
                  aria-hidden="true"
                  className={`absolute inset-x-0 bottom-0 grid h-6 place-items-center text-[11px] font-extrabold not-italic tabular-nums ${
                    full ? "bg-acc text-acc-ink" : "bg-bg text-text-2"
                  }`}
                >
                  {full ? "100%" : p === null ? "—" : `${p}%`}
                </em>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 ${
                    full ? "shadow-[inset_0_0_0_2px_var(--acc)]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]"
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {game && open ? (
        <div
          role="group"
          aria-label={`Detalhe de ${game.name}`}
          className="absolute top-4 z-10 grid w-[290px] grid-cols-[76px_minmax(0,1fr)] gap-3 bg-hover-2 p-3 shadow-[0_16px_34px_rgba(0,0,0,.6)] tk-cut"
          style={{ left: open.left }}
        >
          {game.coverUrl ?? game.heroUrl ? (
            <RemoteImg
              url={(game.coverUrl ?? game.heroUrl)!}
              alt=""
              width={76}
              height={114}
              sizes="76px"
              shape="fit"
              className="aspect-[2/3] w-[76px] bg-track object-cover"
            />
          ) : (
            <span aria-hidden="true" className="aspect-[2/3] w-[76px] bg-track" />
          )}
          <div className="min-w-0">
            <strong className="block leading-tight font-extrabold">{game.name}</strong>
            {isFull(game) ? (
              <TralkedStamp unlocked={game.unlocked} total={game.total} className="mt-1.5" />
            ) : null}
            <small className="mt-1 block text-[12.5px] text-text-2">{formatHours(game.playtimeMin)} jogadas</small>
            {game.total > 0 ? (
              <>
                <span aria-hidden="true" className="relative mt-2 block h-1.5 overflow-hidden bg-track">
                  <i
                    className={`absolute inset-y-0 left-0 ${isFull(game) ? "bg-acc" : "bg-acc-dim"}`}
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </span>
                <small className="mt-1 block text-[12.5px] text-text-2 tabular-nums">
                  {game.unlocked} de {game.total} conquistas ({pct}%)
                </small>
              </>
            ) : (
              <small className="mt-1 block text-[12.5px] text-muted">Sem conquistas</small>
            )}
            <Link
              href={`/jogos/${game.slug}`}
              className="mt-2 inline-block text-xs font-extrabold font-stretch-[80%] tracking-[0.06em] text-acc uppercase hover:underline"
            >
              Abrir a página do jogo
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
