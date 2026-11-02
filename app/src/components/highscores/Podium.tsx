import Link from "next/link";
import type { CSSProperties } from "react";
import type { Board } from "@/lib/highscores/boards";
import { rowDisplay } from "@/lib/highscores/format";
import type { BoardRow } from "@/lib/highscores/queries";
import { CountUp } from "./CountUp";
import { PlayerAvatar, RankDelta } from "./parts";
import "./highscores.css";

const MEDAL = ["var(--gold)", "var(--silver)", "var(--bronze)"];
const SLOT = ["hs-slot1", "hs-slot2", "hs-slot3"];
const PLINTH_HEIGHT = ["176px", "132px", "104px"];
/** The 3rd rises first, the 1st last. */
const RISE_DELAY = [420, 220, 60];
const AVATAR = [96, 76, 68];

const slotStyle = (i: number) =>
  ({
    "--medal": MEDAL[i],
    "--plinth-h": PLINTH_HEIGHT[i],
    "--rise-delay": `${RISE_DELAY[i]}ms`,
    "--head-delay": `${RISE_DELAY[i] + 260}ms`,
  }) as CSSProperties;

/**
 * Top 3: plinths rise one after the other while their numbers count up. Static (cached) markup:
 * the viewer's own slot is marked after hydration by `MarkViewerRow` (`data-player-id`).
 * A board with fewer than three players keeps its three steps: the empty ones are an open
 * invitation ("Seu lugar aqui"), never a blank third of the screen.
 */
export function Podium({
  board,
  rows,
  leaderValue,
  since,
}: {
  board: Board;
  rows: BoardRow[];
  leaderValue: number;
  since: string | null;
}) {
  const open = [0, 1, 2].slice(rows.length);
  return (
    <ol aria-label="Pódio" className="hs-podium">
      {rows.map((row, i) => {
        const display = rowDisplay(board, row, leaderValue);
        return (
          <li key={row.userId} data-player-id={row.userId} className={`hs-slot ${SLOT[i]}`} style={slotStyle(i)}>
            <div className="hs-slot-head">
              <PlayerAvatar
                avatarUrl={row.avatarUrl}
                displayName={row.displayName}
                size={AVATAR[i]}
                medal={MEDAL[i]}
              />
              <div className="flex min-w-0 flex-col items-center gap-1 max-[640px]:items-start">
                <span className="sr-only">{row.rank}º lugar: </span>
                <Link
                  href={`/jogador/${encodeURIComponent(row.handle)}`}
                  className="max-w-full truncate text-[17px] font-bold hover:text-acc"
                >
                  @{row.handle}
                </Link>
                <span className="hs-you-tag font-mono text-xs text-acc">você</span>
                <span className="font-mono text-xs text-dim">{row.vocation}</span>
                <span className="flex items-baseline gap-1.5">
                  <CountUp
                    value={display.value}
                    delay={RISE_DELAY[i] + 200}
                    compact={display.compact}
                    title={display.valueTitle}
                    className={`text-[28px] leading-none font-black font-stretch-[125%] tabular-nums ${
                      i === 0 ? "text-acc" : "text-text"
                    }`}
                  />
                  <span className="font-mono text-xs text-muted">{display.unit}</span>
                </span>
                <span className="font-mono text-xs text-dim" title={display.detailTitle}>
                  {display.detail}
                </span>
                <RankDelta rank={row.rank} previousRank={row.previousRank} isNew={row.isNew} since={since} index={i} />
              </div>
            </div>
            <div className="hs-plinth" aria-hidden="true">
              <span className="hs-plinth-rank">{row.rank}</span>
            </div>
          </li>
        );
      })}
      {open.map((i) => (
        <li key={`vaga-${i}`} className={`hs-slot hs-slot-open ${SLOT[i]}`} style={slotStyle(i)}>
          <div className="hs-slot-head">
            <span aria-hidden="true" className="hs-avatar hs-avatar-open" style={{ width: AVATAR[i], height: AVATAR[i] }}>
              <svg viewBox="0 0 24 24" width="40%" height="40%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <div className="flex min-w-0 flex-col items-center gap-1 max-[640px]:items-start">
              <span className="sr-only">{i + 1}º lugar: vago. </span>
              <b className="text-[17px] font-bold">Seu lugar aqui</b>
              <span className="max-w-[24ch] text-[13px] text-muted max-[640px]:max-w-none">
                Sincronize suas conquistas e suba ao pódio.
              </span>
              <Link
                href="/conta/conexoes"
                className="mt-1 inline-flex min-h-11 items-center font-mono text-xs tracking-[0.08em] text-acc uppercase underline-offset-[3px] hover:underline"
              >
                Conectar contas
              </Link>
            </div>
          </div>
          <div className="hs-plinth" aria-hidden="true">
            <span className="hs-plinth-rank">{i + 1}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
