import Link from "next/link";
import type { Board } from "@/lib/highscores/boards";
import { rowDisplay, shownValue } from "@/lib/highscores/format";
import type { BoardRow } from "@/lib/highscores/queries";
import { PlayerAvatar, RankBar, RankDelta } from "./parts";

/**
 * Positions after the podium. Static (cached) markup: the viewer's row is marked after hydration
 * by `MarkViewerRow`, and a viewer further down gets their own row from the viewer island.
 */
export function RankList({
  board,
  rows,
  leaderValue,
  since,
  caption,
}: {
  board: Board;
  rows: BoardRow[];
  leaderValue: number;
  since: string | null;
  caption: string;
}) {
  if (rows.length === 0) return null;
  return (
    <ol aria-label={caption} className="m-0 mt-8 list-none border-t border-line p-0">
      {rows.map((row, i) => (
        <RankRow key={row.userId} board={board} row={row} leaderValue={leaderValue} since={since} index={i} />
      ))}
    </ol>
  );
}

export function RankRow({
  board,
  row,
  leaderValue,
  since,
  index,
  me = false,
}: {
  board: Board;
  row: BoardRow;
  leaderValue: number;
  since: string | null;
  index: number;
  /** Rendered for the viewer (their own row below the list). */
  me?: boolean;
}) {
  const display = rowDisplay(board, row, leaderValue);
  return (
    <li
      data-player-id={me ? undefined : row.userId}
      data-me={me ? "" : undefined}
      id={me ? "minha-posicao" : undefined}
      aria-current={me ? "true" : undefined}
      className="hs-row grid scroll-mt-24 grid-cols-[44px_52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-3 py-3 sm:grid-cols-[52px_60px_minmax(0,1fr)_minmax(120px,240px)_auto]"
    >
      <span className="text-xl font-black font-stretch-[125%] text-dim tabular-nums">{row.rank}</span>
      <RankDelta rank={row.rank} previousRank={row.previousRank} isNew={row.isNew} since={since} index={index} />
      <span className="flex min-w-0 items-center gap-3">
        <PlayerAvatar avatarUrl={row.avatarUrl} displayName={row.displayName} size={36} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">
            <Link href={`/jogador/${encodeURIComponent(row.handle)}`} className="font-bold hover:text-acc">
              @{row.handle}
            </Link>
            <span className="hs-you-tag text-acc"> (você)</span>
          </span>
          <span className="truncate font-mono text-xs text-muted" title={display.detailTitle}>
            {row.vocation}, {display.detail}
          </span>
        </span>
      </span>
      <span className="col-span-4 col-start-1 row-start-2 sm:col-span-1 sm:col-start-4 sm:row-start-1">
        <RankBar value={display.bar} label={display.barLabel} index={index} color="var(--text-3)" />
      </span>
      <span className="col-start-4 row-start-1 flex items-baseline justify-end gap-1.5 whitespace-nowrap sm:col-start-5">
        <b className="text-lg font-black font-stretch-[125%] tabular-nums" title={display.valueTitle}>
          {shownValue(display)}
        </b>
        <span className="font-mono text-xs text-muted">{display.unit}</span>
      </span>
    </li>
  );
}
