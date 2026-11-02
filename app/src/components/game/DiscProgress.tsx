"use client";

import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { Hues } from "@/components/art/GameArt";
import type { DiscLabelArt } from "@/lib/queries/game-profile";
import { Disc } from "./Disc";

/*
 * Right page of the booklet: the disc in its slot with the progress ring around it. At 100% the
 * disc is the gold "platinado" one on its own; below that, "Ver o disco platinado" previews it.
 * The toggle needs JS, so it only appears after hydration. While the case intro runs, page CSS
 * hides this disc (the flying one lands here) and holds the ring at zero.
 */

const C = 2 * Math.PI * 48;

const CSS = `
.gpp-hold { position: relative; width: min(340px, 100%); aspect-ratio: 1; }
.gpp-hold .gpd { transition: opacity .3s; }
.gpp-ring { position: absolute; inset: -14px; pointer-events: none; }
.gpp-ring circle { fill: none; stroke-width: 3; }
.gpp-trk { stroke: var(--border-2); }
.gpp-val { stroke-dasharray: var(--ring); stroke: var(--acc); stroke-linecap: butt; transition: stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1) .4s, stroke .4s; }
.gpp-hold.gpp-plat .gpp-val { stroke: var(--gold); }
.gpp-toggle { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-family: var(--font-jetbrains-mono), monospace; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); cursor: pointer; }
.gpp-toggle input { appearance: none; width: 30px; height: 16px; border-radius: 999px; background: var(--border-2); position: relative; cursor: pointer; margin: 0; transition: background .2s; }
.gpp-toggle input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text); transition: transform .2s; }
.gpp-toggle input:checked { background: var(--gold); }
.gpp-toggle input:checked::after { transform: translateX(14px); background: var(--bg); }
.gpp-toggle:hover { color: var(--text); }
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
      </div>
      {children}
      {hydrated && !platinum && canPreview ? (
        <label className="gpp-toggle gp-veil" style={{ "--d": ".44s" } as CSSProperties}>
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
          Ver o disco platinado
        </label>
      ) : null}
    </>
  );
}
