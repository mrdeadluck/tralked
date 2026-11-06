import type { CSSProperties } from "react";
import type { TrophyTier } from "@/lib/engine/trophies";

/*
 * Pieces of the hero's progress column: headline styles and the trophy grid. Presentational only.
 */

export const PROGRESS_CSS = `
.gpg { text-align: center; }
.gpg b { font-weight: 900; font-stretch: 112%; font-size: 32px; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.gpg b span { color: var(--acc); }
.gpg p { font-size: 13.5px; color: var(--text-2); margin-top: 5px; max-width: 40ch; margin-inline: auto; }
.gpg p a { color: var(--acc); text-decoration: underline; text-underline-offset: 3px; }
.gpg-none b { font-size: 26px; text-transform: uppercase; }
.gpg-none p { max-width: 34ch; line-height: 1.5; }
/* Version rows under the disc (VersionRows), their caption and the sign-in line. */
.gpv { display: grid; gap: 6px; width: 100%; }
.vr-cap { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; width: 100%; }
.vr-cap small { font-size: 12.5px; color: var(--muted); }
.vr-login { font-size: 13.5px; color: var(--text-2); text-align: center; }
.vr-login a { color: var(--acc); text-decoration: underline; text-underline-offset: 3px; }
.gpt { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; width: 100%; max-width: 380px; margin: 0; padding: 0; list-style: none; }
.gpt li { background: color-mix(in oklch, var(--surface) 85%, transparent); padding: 8px 4px; text-align: center; }
.gpt svg { display: block; width: 14px; height: 14px; margin: 0 auto 2px; }
.gpt b { display: block; font-weight: 900; font-stretch: 112%; font-size: 19px; line-height: 1.15; font-variant-numeric: tabular-nums; }
.gpt small { display: block; font-stretch: 75%; font-weight: 750; font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.gpt li[data-tralked] { background: color-mix(in oklch, var(--moss-2) 70%, transparent); }
.gpt li[data-tralked] b { color: var(--acc); }
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
