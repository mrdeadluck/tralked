"use client";

import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { Hues } from "@/components/art/GameArt";
import type { DiscLabelArt } from "@/lib/queries/game-profile";
import { Disc } from "./Disc";

/*
 * The hero's progress disc: the disc in its slot with a lime progress ring around it. At 100% the
 * disc is the gold one with the "TRALKED!" stamp; below that, "Ver o disco Tralked!" previews it.
 * The toggle needs JS, so it only appears after hydration. While the case intro runs, page CSS
 * hides this disc (the flying one lands here) and holds the ring at zero.
 */

const C = 2 * Math.PI * 48;

const CSS = `
.gpp-hold { position: relative; width: min(240px, calc(100% - 28px)); aspect-ratio: 1; margin: 14px; }
.gpp-hold .gpd { transition: opacity .3s; }
.gp[data-landed] .gpp-hold .gpd { transition: none; }
.gpp-ring { position: absolute; inset: -14px; pointer-events: none; }
.gpp-ring circle { fill: none; stroke-width: 2.2; }
.gpp-trk { stroke: color-mix(in oklch, var(--hover-2) 85%, transparent); }
.gpp-val { stroke-dasharray: var(--ring); stroke: var(--acc); stroke-linecap: butt; transition: stroke-dasharray 1.4s cubic-bezier(.16,1,.3,1) .4s, stroke .4s; }
.gpp-hold.gpp-plat .gpp-val { stroke: var(--gold); }
/* The 100% stamp: lime, slightly turned, as on the profile. */
.gpp-stamp { position: absolute; right: -18px; top: 8px; z-index: 2; display: inline-flex; align-items: center; height: 24px; padding: 0 8px; background: var(--acc); color: var(--acc-ink); font-weight: 900; font-stretch: 112%; font-size: 12.5px; letter-spacing: .02em; rotate: -3deg; box-shadow: 2px 2px 0 rgba(0,0,0,.35); animation: gpp-stamp .45s cubic-bezier(.16,1,.3,1); }
@keyframes gpp-stamp { from { scale: 2.2; opacity: 0; } }
.gpp-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-stretch: 80%; font-weight: 750; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); cursor: pointer; }
.gpp-toggle input { appearance: none; width: 30px; height: 16px; background: var(--border-2); position: relative; cursor: pointer; margin: 0; transition: background .2s; }
.gpp-toggle input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; background: var(--text); transition: transform .2s; }
.gpp-toggle input:checked { background: var(--gold); }
.gpp-toggle input:checked::after { transform: translateX(14px); background: var(--bg); }
.gpp-toggle input:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
.gpp-toggle:hover { color: var(--text); }
@media (prefers-reduced-motion: reduce) { .gpp-stamp { animation: none; } }
`;

const subscribeNothing = () => () => undefined;

export function DiscProgress({
  pct,
  platinum,
  hues,
  seed,
  art,
  name,
  label,
  platLabel,
  preview: canPreview = true,
  children,
}: {
  /** "Ver o disco platinado" toggle; off for a game without achievements (there is no platinum). */
  preview?: boolean;
  pct: number;
  /** The visitor has 100%: the disc is platinum and there is no preview toggle. */
  platinum: boolean;
  hues: Hues;
  seed: number;
  /** Disc label art (never the cover nor the hero). */
  art: DiscLabelArt;
  name: string;
  label: string;
  /** Disc label when shown as platinum. */
  platLabel: string;
  children?: ReactNode;
}) {
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [preview, setPreview] = useState(false);
  const plat = platinum || preview;
  const shown = plat ? 100 : pct;

  return (
    <>
      <style href="tralked-game-progress" precedence="default">
        {CSS}
      </style>
      <div id="gp-disc-hold" className={`gpp-hold gp-veil ${plat ? "gpp-plat" : ""}`} style={{ "--d": ".15s" } as CSSProperties}>
        <svg className="gpp-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="gpp-trk" cx="50" cy="50" r="48" />
          <circle
            className="gpp-val"
            cx="50"
            cy="50"
            r="48"
            strokeDasharray={`${(C * shown) / 100} ${C}`}
            style={{ "--ring": `${(C * shown) / 100} ${C}` } as CSSProperties}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <Disc
          hues={hues}
          seed={seed}
          art={art}
          name={name}
          label={plat ? platLabel : label}
          plat={plat}
          className="gpd-slow"
        />
        {plat ? (
          <span className="gpp-stamp" aria-hidden="true">
            TRALKED!
          </span>
        ) : null}
      </div>
      {children}
      {hydrated && !platinum && canPreview ? (
        <label className="gpp-toggle gp-veil" style={{ "--d": ".44s" } as CSSProperties}>
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
          Ver o disco Tralked!
        </label>
      ) : null}
    </>
  );
}
