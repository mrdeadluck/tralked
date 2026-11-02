"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { titleFitStyle } from "@/components/game/title-fit";
import type { CaseArtSource } from "@/lib/case-art";
import { GameArt, type Hues } from "./GameArt";

/*
 * The one cover of a game outside the shelves' cases (profile rails, the guide head, the game
 * page's "Na mesma estante", libraries, wishlists): the same ordered sources as the cases
 * (lib/case-art: stored portrait cover → Steam's library_600x900 → wide art), the first that loads
 * wins (a failed image moves on, also when it failed before hydration). Art of the other shape is
 * never cropped through its title: it is shown whole over a blurred copy of itself. With no source
 * left, the generated art carries the game's name, never a debug label.
 */

const CSS = `
.cva { position: relative; display: block; width: 100%; overflow: hidden; background: var(--surface-2, #16171c); container-type: inline-size; }
.cva-img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
.cva-blur { position: absolute; inset: -12%; width: 124%; height: 124%; object-fit: cover; filter: blur(14px) brightness(.55) saturate(1.2); }
.cva-fit { position: absolute; inset: 0; margin: auto; display: block; max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
.cva-gen { position: absolute; inset: 0; }
.cva-gen canvas { width: 100%; height: 100%; }
.cva-top { position: absolute; top: 0; left: 0; right: 0; height: 10%; max-height: 18px; background: var(--bg); border-bottom: 2px solid var(--acc); }
.cva-nm { position: absolute; bottom: 9%; left: 0; right: 0; padding: 0 8%; text-align: center; font-weight: 900; font-stretch: 125%; font-size: min(22px, calc(100cqw * .84 / var(--longest, 1))); line-height: .95; letter-spacing: -0.01em; text-transform: uppercase; color: var(--text); text-shadow: 0 2px 10px rgba(0,0,0,.8); overflow-wrap: normal; word-break: normal; hyphens: manual; }
`;

/** Small stable hash, so a game's generated art does not change between renders. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function huesOf(seed: number): Hues {
  const a = seed % 360;
  return [a, (a + 32) % 360];
}

/** Box shape from a CSS aspect-ratio ("3 / 4" is portrait). */
function isPortrait(ratio: string): boolean {
  const [w, h] = ratio.split("/").map((n) => Number(n.trim()));
  return Boolean(w && h && h > w);
}

export function CoverArt({
  name,
  sources,
  ratio = "3 / 4",
  seed,
  hues,
  alt,
  className = "",
  style,
}: {
  name: string;
  /** Ordered art sources (lib/case-art `caseArt`); empty means generated art. */
  sources: CaseArtSource[];
  /** CSS aspect-ratio of the box. */
  ratio?: string;
  seed?: number;
  hues?: Hues;
  /** Alt text; default "Capa de <name>". Pass "" when the title is printed next to the cover. */
  alt?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [index, setIndex] = useState(0);
  const img = useRef<HTMLImageElement>(null);
  const source = sources[index];
  const portraitBox = isPortrait(ratio);
  const label = alt ?? `Capa de ${name}`;

  // An image that 404'd before React attached onError is "complete" with no pixels.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setIndex((i) => i + 1);
  }, [index]);

  const next = () => setIndex((i) => i + 1);
  const s = seed ?? seedOf(name);

  let body;
  if (!source) {
    body = (
      <>
        <span className="cva-gen">
          <GameArt seed={s} hues={hues ?? huesOf(s)} figure width={300} height={portraitBox ? 414 : 240} />
        </span>
        <span className="cva-top" />
        <span className="cva-nm" aria-hidden="true" style={titleFitStyle(name)}>
          {name}
        </span>
        {label ? <span className="sr-only">{label}</span> : null}
      </>
    );
  } else if (source.wide === portraitBox) {
    // Wide art in a portrait box (or a portrait cover in a wide one): whole, over its own blur.
    body = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art (IGDB, SteamGridDB, Steam) */}
        <img src={source.url} alt="" aria-hidden="true" className="cva-blur" loading="lazy" decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art (IGDB, SteamGridDB, Steam) */}
        <img
          key={source.url}
          ref={img}
          src={source.url}
          alt={label}
          className="cva-fit"
          loading="lazy"
          decoding="async"
          onError={next}
        />
      </>
    );
  } else {
    body = (
      // eslint-disable-next-line @next/next/no-img-element -- hotlinked store art (IGDB, SteamGridDB, Steam)
      <img
        key={source.url}
        ref={img}
        src={source.url}
        alt={label}
        className="cva-img"
        loading="lazy"
        decoding="async"
        onError={next}
      />
    );
  }

  return (
    <span className={`cva ${className}`} style={{ aspectRatio: ratio, ...style }}>
      <style href="tralked-cover-art" precedence="default">
        {CSS}
      </style>
      {body}
    </span>
  );
}
