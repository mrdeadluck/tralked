"use client";

import { useId, useState, type CSSProperties } from "react";
import type { Hues } from "@/components/art/GameArt";
import type { DiscLabelArt } from "@/lib/queries/game-profile";
import { DiscProgress } from "./DiscProgress";
import { PROGRESS_CSS, TrophyGrid, type ProgressView } from "./progress-parts";

const delay = (d: string) => ({ "--d": d }) as CSSProperties;
const fmt = (n: number) => n.toLocaleString("pt-BR");

/**
 * Right page of the booklet for a player with the game on more than one platform: a segmented
 * control (native radios, so arrow keys move between platforms) picks which platform the disc
 * ring, the numbers and the trophy grid show, or "Todas" for every platform together. It starts
 * on `initial` (the platform with the most progress); without JS that view is the one shown, and
 * each option's label still carries its own percentage.
 */
export function PlatformProgressSwitch({
  views,
  initial,
  hues,
  seed,
  art,
  name,
}: {
  views: ProgressView[];
  initial: string;
  hues: Hues;
  seed: number;
  art: DiscLabelArt;
  name: string;
}) {
  const id = useId();
  const [selected, setSelected] = useState(initial);
  const view = views.find((v) => v.id === selected) ?? views[0];

  return (
    <>
      <style href="tralked-game-booklet-progress" precedence="default">
        {PROGRESS_CSS}
      </style>
      <DiscProgress
        pct={view.pct}
        platinum={view.completed}
        hues={hues}
        seed={seed}
        art={art}
        name={name}
        label="TRALKED · DISCO 1"
        platLabel={view.platLabel}
      >
        {views.length > 1 ? (
          <fieldset className="gpx gp-veil" style={delay(".26s")}>
            <legend className="sr-only">{view.catalog ? "Conquistas por plataforma" : "Progresso por plataforma"}</legend>
            <div className="gpx-row">
              {views.map((v) => (
                <label
                  key={v.id}
                  className="gpx-opt"
                  data-all={v.color ? undefined : ""}
                  data-done={v.completed ? "" : undefined}
                  style={v.color ? ({ "--c": v.color } as CSSProperties) : undefined}
                >
                  <input
                    type="radio"
                    name={`${id}-plataforma`}
                    value={v.id}
                    checked={v.id === view.id}
                    onChange={() => setSelected(v.id)}
                  />
                  <span>{v.label}</span>
                  <span className="gpx-val">{v.badge ?? `${v.pct}%`}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="gpg gp-veil" style={delay(".3s")} aria-live="polite">
          {view.catalog ? (
            <b>{fmt(view.total)}</b>
          ) : (
            <b>
              {fmt(view.unlocked)}
              <span>/</span>
              {fmt(view.total)}
            </b>
          )}
          <p>
            {view.detail}
            {view.link ? <a href={view.link.href}>{view.link.label}</a> : null}
          </p>
        </div>
        <TrophyGrid values={view.trophies} label={view.trophiesLabel} style={delay(".38s")} />
      </DiscProgress>
    </>
  );
}
