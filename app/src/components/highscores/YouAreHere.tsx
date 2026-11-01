import Link from "next/link";
import type { ReactNode } from "react";
import type { Board } from "@/lib/highscores/boards";
import { gapText, rowDisplay } from "@/lib/highscores/format";
import type { Standing } from "@/lib/highscores/queries";
import { CountUp } from "./CountUp";
import { PlayerAvatar, RankDelta } from "./parts";
import "./highscores.css";

type Viewer = { handle: string; profilePublic: boolean } | null;

/**
 * "Você está aqui": the viewer's rank on this board, pinned to the bottom of the screen, with the
 * distance to the player right above. Logged out, private or unranked viewers get the way in.
 */
export function YouAreHere({
  board,
  viewer,
  standing,
  leaderValue,
  since,
}: {
  board: Board;
  viewer: Viewer;
  standing: Standing | null;
  leaderValue: number;
  since: string | null;
}) {
  if (!viewer) {
    return (
      <Bar>
        <p className="text-sm text-text-2">Entre para ver a sua posição em cada ranking.</p>
        <Action href="/entrar">Entrar</Action>
      </Bar>
    );
  }
  if (!viewer.profilePublic) {
    return (
      <Bar>
        <p className="text-sm text-text-2">Seu perfil está privado, por isso você não aparece no ranking.</p>
        <Action href="/conta">Tornar público</Action>
      </Bar>
    );
  }
  if (!standing) {
    return (
      <Bar>
        <p className="text-sm text-text-2">Você ainda não aparece neste ranking. Conecte suas contas e sincronize para entrar.</p>
        <Action href="/conta/conexoes">Conectar contas</Action>
      </Bar>
    );
  }

  const { row, above } = standing;
  const display = rowDisplay(board, row, leaderValue);
  return (
    <Bar>
      <div className="flex min-w-0 items-center gap-3">
        <PlayerAvatar avatarUrl={row.avatarUrl} displayName={row.displayName} size={40} medal="var(--acc)" />
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-[11px] text-acc">Você está aqui</span>
          <span className="flex items-baseline gap-2">
            <span className="text-[26px] leading-none font-black font-stretch-[125%] tabular-nums">
              <span aria-hidden="true">#</span>
              <span className="sr-only">Posição </span>
              {row.rank.toLocaleString("pt-BR")}
            </span>
            <RankDelta rank={row.rank} previousRank={row.previousRank} isNew={row.isNew} since={since} />
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-0.5 sm:items-end">
        <span className="flex items-baseline gap-1.5">
          <CountUp value={display.value} delay={700} className="text-lg font-black font-stretch-[125%] tabular-nums" />
          <span className="font-mono text-[11px] text-muted">{display.unit}</span>
        </span>
        <span className="text-[13px] text-text-2">
          {above ? gapText(board, row, above) : "Você lidera este ranking."}
        </span>
      </div>
      {/* A shortcut on wide screens; on phones the bar stays compact. */}
      <span className="hidden sm:contents">
        <Action href="#minha-posicao">Ver na lista</Action>
      </span>
    </Bar>
  );
}

function Bar({ children }: { children: ReactNode }) {
  return (
    <aside
      aria-label="Sua posição"
      className="hs-you mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[4px] border border-line-2 bg-surface-2/95 px-4 py-3 shadow-[inset_3px_0_0_var(--acc),0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur"
    >
      {children}
    </aside>
  );
}

function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 shrink-0 items-center rounded-[2px] border border-acc px-3 font-mono text-[11px] tracking-[0.08em] text-acc uppercase hover:bg-acc hover:text-bg"
    >
      {children}
    </Link>
  );
}
