import Link from "next/link";
import { Suspense, ViewTransition } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { boardKey, boardTitle, METRIC_HINT, MIN_PODIUM, type Board } from "@/lib/highscores/boards";
import { getBoardCached } from "@/lib/highscores/cached";
import { shortDay } from "@/lib/highscores/format";
import { getStanding, type BoardView } from "@/lib/highscores/queries";
import { BoardNav } from "./BoardNav";
import { MarkViewerRow } from "./MarkViewerRow";
import { Podium } from "./Podium";
import { RankList, RankRow } from "./RankList";
import { YouAreHere, YouAreHereSkeleton } from "./YouAreHere";

/**
 * One highscores board. The ranks are public and cached (prerendered with the page, so they work
 * without JS); everything about the viewer is a dynamic island below them.
 */
export async function BoardScreen({ board }: { board: Board }) {
  const key = boardKey(board);
  const view = await getBoardCached(key);
  const rows = view.rows;
  const leaderValue = rows[0]?.value ?? 0;
  const since = view.snapshotDay ? shortDay(view.snapshotDay) : null;
  const title = boardTitle(board);
  const openPodium = rows.length > 0 && rows.length < MIN_PODIUM;

  return (
    <div className="pt-4">
      <BoardNav board={board} />
      <p className="mt-4 text-sm text-dim">
        {METRIC_HINT[board.metric]}
        {since ? ` As setas mostram a mudança de posição desde ${since}.` : null}{" "}
        <Link href="/como-funciona" className="whitespace-nowrap text-acc underline-offset-[3px] hover:underline">
          Como funciona o XP
        </Link>
      </p>

      <ViewTransition key={key} name="highscores-board" share="auto" enter="auto" default="none">
        <section aria-labelledby="ranking-titulo" className="mt-8">
          <h2 id="ranking-titulo" className="sr-only">
            Ranking: {title}
          </h2>
          {rows.length === 0 ? (
            <div className="rounded-[4px] border border-dashed border-line-2 px-6 py-12 text-center">
              <p className="text-lg font-bold">Ninguém neste ranking ainda.</p>
              <p className="mt-2 text-sm text-muted">
                Conecte suas contas e sincronize para ser o primeiro.{" "}
                <Link href="/conta/conexoes" className="text-acc underline-offset-4 hover:underline">
                  Conectar contas
                </Link>
              </p>
            </div>
          ) : (
            <>
              <Podium board={board} rows={rows.slice(0, 3)} leaderValue={leaderValue} since={since} />
              <RankList
                board={board}
                rows={rows.slice(3)}
                leaderValue={leaderValue}
                since={since}
                caption={`Ranking: ${title}, do 4º lugar em diante`}
              />
            </>
          )}
          {/*
           * The island streams in after the cached list: its fallback holds the bar's room. With an
           * open podium step most visitors get no bar (the step is the invitation): no room held.
           */}
          <Suspense fallback={openPodium ? null : <YouAreHereSkeleton />}>
            <ViewerIsland board={board} view={view} leaderValue={leaderValue} since={since} openPodium={openPodium} />
          </Suspense>
        </section>
      </ViewTransition>
    </div>
  );
}

/** Per-viewer part: highlight, own row below the top, and the "Você está aqui" bar. */
async function ViewerIsland({
  board,
  view,
  leaderValue,
  since,
  openPodium,
}: {
  board: Board;
  view: BoardView;
  leaderValue: number;
  since: string | null;
  openPodium: boolean;
}) {
  const viewer = await getSessionUser();
  // Live rank, while the list above is cached for a few minutes: right after a sync the two can
  // briefly disagree (the list catches up when its cache expires or the daily cron refreshes it).
  const standing = viewer?.profilePublic ? await getStanding(viewer.id, board) : null;
  const inTop = standing ? view.rows.some((r) => r.userId === standing.row.userId) : false;

  return (
    <>
      {standing && inTop ? <MarkViewerRow userId={standing.row.userId} boardKey={view.key} /> : null}
      {standing && !inTop ? (
        <ol aria-label="Sua posição no ranking" className="m-0 list-none p-0">
          <li aria-hidden="true" className="border-b border-line py-1 text-center font-mono text-dim">
            …
          </li>
          <RankRow board={board} row={standing.row} leaderValue={leaderValue} since={since} index={view.rows.length} me />
        </ol>
      ) : null}
      <YouAreHere
        board={board}
        viewer={viewer ? { handle: viewer.handle, profilePublic: viewer.profilePublic } : null}
        standing={standing}
        leaderValue={leaderValue}
        since={since}
        openPodium={openPodium}
      />
    </>
  );
}
