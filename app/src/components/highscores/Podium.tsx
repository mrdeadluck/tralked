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

/**
 * Top 3: plinths rise one after the other while their numbers count up. Static (cached) markup:
 * the viewer's own slot is marked after hydration by `MarkViewerRow` (`data-player-id`).
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
  return (
    <ol aria-label="Pódio" className="hs-podium">
      {rows.map((row, i) => {
        const display = rowDisplay(board, row, leaderValue);
        const rise = RISE_DELAY[i];
        return (
          <li
            key={row.userId}
            data-player-id={row.userId}
            className={`hs-slot ${SLOT[i]}`}
            style={
              {
                "--medal": MEDAL[i],
                "--plinth-h": PLINTH_HEIGHT[i],
                "--rise-delay": `${rise}ms`,
                "--head-delay": `${rise + 260}ms`,
              } as CSSProperties
            }
          >
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
                    delay={rise + 200}
                    className={`text-[28px] leading-none font-black font-stretch-[125%] tabular-nums ${
                      i === 0 ? "text-acc" : "text-text"
                    }`}
                  />
                  <span className="font-mono text-xs text-muted">{display.unit}</span>
                </span>
                <span className="font-mono text-xs text-dim">{display.detail}</span>
                <RankDelta rank={row.rank} previousRank={row.previousRank} isNew={row.isNew} since={since} index={i} />
              </div>
            </div>
            <div className="hs-plinth" aria-hidden="true">
              <span className="hs-plinth-rank">{row.rank}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
