import type { CSSProperties } from "react";
import type { TrophyTier } from "@/lib/engine/trophies";

/*
 * Pieces of the hero's progress column shared by the server render and the
 * platform switch (a client island): headline styles, the platform segmented control and the
 * trophy grid. Presentational only, so both sides can import it.
 */

export const PROGRESS_CSS = `
.gpg { text-align: center; }
.gpg b { font-weight: 900; font-stretch: 112%; font-size: 32px; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.gpg b span { color: var(--acc); }
.gpg p { font-size: 13.5px; color: var(--text-2); margin-top: 5px; max-width: 40ch; margin-inline: auto; }
.gpg p a { color: var(--acc); text-decoration: underline; text-underline-offset: 3px; }
.gpg-none b { font-size: 26px; text-transform: uppercase; }
.gpg-none p { max-width: 34ch; line-height: 1.5; }
.gpt { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; width: 100%; max-width: 380px; margin: 0; padding: 0; list-style: none; }
.gpt li { background: color-mix(in oklch, var(--surface) 85%, transparent); padding: 8px 4px; text-align: center; }
.gpt svg { display: block; width: 14px; height: 14px; margin: 0 auto 2px; }
.gpt b { display: block; font-weight: 900; font-stretch: 112%; font-size: 19px; line-height: 1.15; font-variant-numeric: tabular-nums; }
.gpt small { display: block; font-stretch: 75%; font-weight: 750; font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.gpt li[data-tralked] { background: color-mix(in oklch, var(--moss-2) 70%, transparent); }
.gpt li[data-tralked] b { color: var(--acc); }
.gpx { display: flex; flex-wrap: wrap; justify-content: center; max-width: 100%; margin: 0; padding: 0; border: 0; }
.gpx-row { display: inline-flex; flex-wrap: wrap; justify-content: center; background: var(--bg); box-shadow: inset 0 0 0 1px var(--border); }
.gpx-opt { position: relative; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; font-stretch: 80%; font-weight: 750; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-2); cursor: pointer; white-space: nowrap; transition: background .2s, color .2s; }
.gpx-opt::before { content: ""; width: 6px; height: 6px; flex: none; background: var(--c, var(--muted)); }
.gpx-opt[data-all]::before { display: none; }
.gpx-opt input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.gpx-opt:hover { color: var(--text); }
.gpx-val { color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
.gpx-opt[data-done] .gpx-val { color: var(--gold); }
.gpx-opt:has(input:checked) { background: var(--hover-2); color: var(--text); box-shadow: inset 0 -2px 0 var(--acc); }
.gpx-opt:has(input:checked) .gpx-val { color: var(--text-2); }
.gpx-opt:has(input:focus-visible) { outline: 2px solid var(--acc); outline-offset: 2px; z-index: 1; }
@media (max-width: 600px) {
  .gpx-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
  .gpx-opt { justify-content: center; }
  /* Three platforms share one row (two-and-one left "Xbox 7" alone on a second line). */
  .gpx-row[data-n="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .gpx-row[data-n="3"] .gpx-opt { padding: 0 6px; gap: 6px; }
}
`;

const TROPHY_UI: { tier: TrophyTier; label: string; color: string }[] = [
  { tier: "platinum", label: "Platina", color: "var(--plat)" },
  { tier: "gold", label: "Ouro", color: "var(--gold)" },
  { tier: "silver", label: "Prata", color: "var(--silver)" },
  { tier: "bronze", label: "Bronze", color: "var(--bronze)" },
];

function TrophyIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v5a5 5 0 0 1-10 0z M10 14h4v3h3v3H7v-3h3z" style={{ fill: color }} />
    </svg>
  );
}

/**
 * The four trophy tiers, platinum first; `values` already formatted ("1/2", "12"). `tralked`: the
 * platform has no platinum trophy of its own, so the platinum is Tralked's reward for the 100%
 * ("Platina Tralked"), apart from the achievements: gold + silver + bronze add up to the total.
 */
export function TrophyGrid({
  values,
  label,
  style,
  tralked = false,
}: {
  values: Record<TrophyTier, string>;
  label: string;
  style?: CSSProperties;
  tralked?: boolean;
}) {
  return (
    <ul className="gpt gp-veil" style={style} aria-label={label}>
      {TROPHY_UI.map(({ tier, label: name, color }) => {
        const own = tier === "platinum" && tralked;
        return (
          <li
            key={tier}
            data-tralked={own ? "" : undefined}
            title={own ? "Platina do Tralked: vem com os 100%, fora da contagem de conquistas" : undefined}
          >
            <TrophyIcon color={color} />
            <b>{values[tier]}</b>
            <small>{own ? "Platina Tralked" : name}</small>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One tab of the platform switch: a platform the player has the game on, or every platform
 * together. Built on the server (pt-BR copy included), so the switch only picks one.
 */
export type ProgressView = {
  /** Platform id, or "todas". */
  id: string;
  /** Tab label ("Steam", "PSN", "Todas"). */
  label: string;
  /** Platform color token; null for "todas". */
  color: string | null;
  unlocked: number;
  total: number;
  pct: number;
  completed: boolean;
  /** "Platina" (the platinum trophy itself), "100%", or null while incomplete. */
  badge: string | null;
  /** The game's own numbers (no player progress): the headline is the total alone. */
  catalog?: boolean;
  /** Line under the numbers ("conquistas na Steam · 98% · falta 1 para platinar"). */
  detail: string;
  /** A link closing the detail line ("entre para ver o seu progresso"). */
  link?: { href: string; label: string };
  /** Disc label when platinum. */
  platLabel: string;
  trophies: Record<TrophyTier, string>;
  trophiesLabel: string;
  /** The platinum is Tralked's (no native platinum trophy on this platform): see TrophyGrid. */
  tralkedPlatinum?: boolean;
};
