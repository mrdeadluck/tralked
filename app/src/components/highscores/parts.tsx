import type { CSSProperties } from "react";
import { deltaText } from "@/lib/highscores/format";
import "./highscores.css";

/** Round avatar (Steam art when there is one, else the initial). */
export function PlayerAvatar({
  avatarUrl,
  displayName,
  size,
  medal = "var(--border-2)",
}: {
  avatarUrl: string | null;
  displayName: string;
  size: number;
  medal?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="hs-avatar shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), "--medal": medal } as CSSProperties}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Steam avatar, external domain
        <img src={avatarUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        displayName.charAt(0).toUpperCase()
      )}
    </span>
  );
}

/** Drawn marks of the rank change (no text glyphs): up, down, or a still dot. */
function DeltaMark({ kind }: { kind: "up" | "down" | "same" }) {
  if (kind === "same") {
    return (
      <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2">
        <circle cx="5" cy="5" r="3" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className={`size-2.5 ${kind === "down" ? "rotate-180" : ""}`}>
      <path d="M5 1.5 9.5 8.5H.5z" fill="currentColor" />
    </svg>
  );
}

/**
 * Rank change since the reference snapshot: a lime triangle up, a red one down, a gray dot for the
 * same place, "novo" for a player who entered the snapshot's range; a dash without history.
 * Screen readers get the sentence ("Subiu 2 posições desde 30/10").
 */
export function RankDelta({
  rank,
  previousRank,
  isNew,
  since,
  index = 0,
}: {
  rank: number;
  previousRank: number | null;
  isNew: boolean;
  /** "30/10" */
  since: string | null;
  index?: number;
}) {
  const text = deltaText(rank, previousRank, isNew);
  if (!text || !since) {
    return (
      <span aria-hidden="true" className="font-mono text-xs text-dim">
        –
      </span>
    );
  }
  const delta = previousRank === null ? 0 : previousRank - rank;
  const kind = delta > 0 ? "up" : delta < 0 ? "down" : "same";
  const color = isNew
    ? "var(--brand-2)"
    : kind === "up"
      ? "var(--acc)"
      : kind === "down"
        ? "var(--nin)"
        : "var(--dim)";
  return (
    <span
      className={`hs-delta inline-flex items-center gap-1 font-mono text-xs font-bold whitespace-nowrap ${
        isNew ? "rounded-[2px] border px-1.5 py-px text-xs tracking-[0.08em] uppercase" : ""
      }`}
      style={{ color, borderColor: color, "--i": index } as CSSProperties}
      title={`${text} desde ${since}`}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {isNew ? (
          "novo"
        ) : (
          <>
            <DeltaMark kind={kind} />
            {kind === "same" ? null : Math.abs(delta)}
          </>
        )}
      </span>
      <span className="sr-only">
        {text} desde {since}
      </span>
    </span>
  );
}

/** Thin animated bar (0..1). */
export function RankBar({
  value,
  label,
  index = 0,
  color = "var(--acc)",
}: {
  value: number;
  label: string;
  index?: number;
  color?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 overflow-hidden rounded-[2px] bg-track"
    >
      <i
        className="hs-fill"
        style={{ width: `${pct}%`, background: color, "--i": index } as CSSProperties}
      />
    </div>
  );
}
