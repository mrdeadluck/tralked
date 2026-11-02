"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { titleBoxFit, titleFitStyle } from "@/components/game/title-fit";
import type { CaseArtSource } from "@/lib/case-art";
import { noteFailedImage, sizedImage } from "@/lib/images/sized";
import { GameArt, type Hues } from "./GameArt";

/*
 * The one cover of a game, everywhere (the shelves' cases in /jogos and /lancamentos, profile
 * rails, the guide head, "Na mesma estante", libraries, wishlists): the ordered sources of
 * lib/case-art (stored portrait cover → Steam's library_600x900 → wide art), the first that loads
 * wins (a failed image moves on, also when it failed before hydration). Art of the other shape is
 * never cropped through its title nor shown over a blurred copy of itself:
 *
 * - wide art in a portrait box is printed as a game case: a body in the art's own colours, a
 *   spine, the Tralked top band, the art as a band across the front and the game's name set
 *   below it;
 * - a portrait cover in a wide box stands as a case on a stage lit in its colours.
 *
 * With no source left, the generated art carries the game's name, kept inside the art.
 */

const CSS = `
.cva { position: relative; display: block; width: 100%; overflow: hidden; background: var(--surface-2, #16171c); container-type: inline-size; isolation: isolate; }
.cva-img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
.cva-gen { position: absolute; inset: 0; }
.cva-gen canvas { width: 100%; height: 100%; }
.cva-top { position: absolute; z-index: 2; top: 0; left: 0; right: 0; height: 10%; max-height: 18px; background: var(--bg); border-bottom: 2px solid var(--acc); }
/* The name on the art: bottom-aligned in its own area, sized to fit it (titleBoxFit), clipped as a last resort. */
.cva-nm { position: absolute; z-index: 2; left: 0; right: 0; bottom: 8%; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; padding: 0 8%; text-align: center; font-weight: 900; font-stretch: 125%; font-size: min(22px, calc(var(--fit, 10) * 1cqw)); line-height: .95; letter-spacing: -0.01em; text-transform: uppercase; color: var(--text); text-shadow: 0 2px 10px rgba(0,0,0,.8); overflow-wrap: normal; word-break: normal; hyphens: manual; }
.cva-gen-nm { top: 14%; }
/* Colour of the art itself: the same image, so blurred and scaled that only its colours remain. */
.cva-wash { position: absolute; inset: 0; z-index: 0; display: block; width: 100%; height: 100%; object-fit: cover; filter: blur(22px) saturate(1.7) brightness(.85); transform: scale(1.8); }
.cva-shade { position: absolute; inset: 0; z-index: 1; }
/* Light on the art plate, dark under the name (its contrast). */
.cva-case .cva-shade { background: radial-gradient(ellipse 80% 34% at 53% 38%, rgba(255,255,255,.1), transparent 70%), linear-gradient(180deg, rgba(10,11,13,.25) 0%, rgba(10,11,13,.2) 50%, rgba(10,11,13,.82) 82%, rgba(10,11,13,.92) 100%); }
.cva-spine { position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; width: 6%; background: linear-gradient(90deg, rgba(0,0,0,.6), rgba(255,255,255,.07) 65%, rgba(0,0,0,.35)); box-shadow: 1px 0 0 rgba(255,255,255,.06); }
/* The band keeps the art's own proportion (a 231×87 capsule is wider than a header) up to 16:9. */
.cva-plate { position: absolute; z-index: 1; top: 15%; left: 6%; right: 0; height: 52.9cqw; display: flex; align-items: center; }
.cva-band { display: block; width: 100%; height: auto; max-height: 100%; object-fit: cover; box-shadow: 0 12px 22px -8px rgba(0,0,0,.8), 0 -1px 0 rgba(255,255,255,.1), 0 1px 0 rgba(255,255,255,.1); }
.cva-case .cva-nm { left: 6%; top: calc(15% + 53.5cqw); bottom: 7%; padding: 0 8%; text-align: left; align-items: flex-start; }
.cva-case::after, .cva-stand::after { content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; background: linear-gradient(115deg, rgba(255,255,255,.08), transparent 38%); }
.cva-stand .cva-shade { background: radial-gradient(ellipse 60% 75% at 50% 45%, transparent 30%, rgba(10,11,13,.7) 100%), linear-gradient(180deg, transparent 70%, rgba(10,11,13,.55)); }
.cva-cover { position: absolute; z-index: 2; top: 8%; left: 50%; display: block; height: 84%; width: auto; max-width: 92%; translate: -50% 0; border-radius: 1px 3px 3px 1px; box-shadow: -4px 0 0 #0d0e12, 0 18px 28px -10px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.06); }
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

type Attempt = { src: string; srcSet?: string; wide: boolean };

/**
 * Each source at the box's size (lib/images/sized: IGDB size tokens, SteamGridDB thumbnails); a
 * guessed CDN thumbnail is followed by its fallbacks (the original last).
 */
function attemptsOf(sources: CaseArtSource[], width: number): Attempt[] {
  return sources.flatMap((source) => {
    const sized = sizedImage(source.url, width, source.wide ? "wide" : "fit");
    return [
      { src: sized.src, srcSet: sized.srcSet, wide: source.wide },
      ...(sized.fallbacks ?? []).map((src) => ({ src, wide: source.wide })),
    ];
  });
}

/** Height per unit of width of a CSS aspect-ratio ("3 / 4" → 1.333); 1 when unreadable. */
function heightRatio(ratio: string): number {
  const [w, h] = ratio.split("/").map((n) => Number(n.trim()));
  return w && h ? h / w : 1;
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
  width = 240,
  sizes = "240px",
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
  /** Widest the box renders (CSS px) and its `sizes`: the CDN copy that covers it is requested. */
  width?: number;
  sizes?: string;
}) {
  // Failed URLs, not an index: a remembered PNG-only thumbnail changes the list of attempts.
  const [failed, setFailed] = useState<string[]>([]);
  const img = useRef<HTMLImageElement>(null);
  const source = attemptsOf(sources, width).find((a) => !failed.includes(a.src));
  const srcSizes = source?.srcSet ? sizes : undefined;
  const tall = heightRatio(ratio);
  const portraitBox = tall > 1;
  const label = alt ?? `Capa de ${name}`;

  const current = source?.src;
  const next = () => {
    if (!current) return;
    noteFailedImage(current);
    setFailed((list) => (list.includes(current) ? list : [...list, current]));
  };

  // An image that 404'd before React attached onError is "complete" with no pixels.
  useEffect(() => {
    const el = img.current;
    // currentSrc: the browser did request it (a lazy image not requested yet is not a failure).
    if (!current || !el || !el.complete || !el.currentSrc || el.naturalWidth !== 0) return;
    noteFailedImage(current);
    setFailed((list) => (list.includes(current) ? list : [...list, current]));
  }, [current]);
  const s = seed ?? seedOf(name);
  const nameStyle = (widthFrac: number, heightFrac: number) =>
    ({ ...titleFitStyle(name), "--fit": titleBoxFit(name, { ratio: tall, widthFrac, heightFrac }) }) as CSSProperties;
  // The same image twice (one request): the wash under it carries its colours.
  const wash = source ? (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked store art (IGDB, SteamGridDB, Steam)
    <img src={source.src} srcSet={source.srcSet} sizes={srcSizes} alt="" aria-hidden="true" className="cva-wash" loading="lazy" decoding="async" />
  ) : null;

  let body;
  let variant = "";
  if (!source) {
    body = (
      <>
        <span className="cva-gen">
          <GameArt seed={s} hues={hues ?? huesOf(s)} figure width={300} height={portraitBox ? 414 : 240} />
        </span>
        <span className="cva-top" />
        {/* Between the top band (≤ 14%) and the foot (8%): 78% of the height, 84% of the width. */}
        <span className="cva-nm cva-gen-nm" aria-hidden="true" style={nameStyle(0.84, 0.76)}>
          {name}
        </span>
        {label ? <span className="sr-only">{label}</span> : null}
      </>
    );
  } else if (source.wide && portraitBox) {
    // Wide art on a portrait case: the art is the band across the front, the name set below it.
    variant = "cva-case";
    // The band is 94% wide at 16:9 (52.9% of the width tall) from 15% of the height; the name
    // takes what is left above the 7% foot.
    const nameHeight = Math.max(0.12, 1 - 0.15 - 0.07 - (0.94 * 9) / 16 / tall - 0.03);
    body = (
      <>
        {wash}
        <span className="cva-shade" />
        <span className="cva-spine" />
        <span className="cva-top" />
        <span className="cva-plate">
          {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art (IGDB, SteamGridDB, Steam) */}
          <img
            key={source.src}
            ref={img}
            src={source.src}
            srcSet={source.srcSet}
            sizes={srcSizes}
            alt={label}
            className="cva-band"
            loading="lazy"
            decoding="async"
            onError={next}
          />
        </span>
        <span className="cva-nm" aria-hidden="true" style={nameStyle(0.94 * 0.84, nameHeight)}>
          {name}
        </span>
      </>
    );
  } else if (!source.wide && !portraitBox) {
    // A portrait cover in a wide box: the case standing whole, on a stage lit in its colours.
    variant = "cva-stand";
    body = (
      <>
        {wash}
        <span className="cva-shade" />
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked store art (IGDB, SteamGridDB, Steam) */}
        <img
          key={source.src}
          ref={img}
          src={source.src}
          srcSet={source.srcSet}
          sizes={srcSizes}
          alt={label}
          className="cva-cover"
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
        key={source.src}
        ref={img}
        src={source.src}
        srcSet={source.srcSet}
        sizes={srcSizes}
        alt={label}
        className="cva-img"
        loading="lazy"
        decoding="async"
        onError={next}
      />
    );
  }

  return (
    <span className={`cva ${variant} ${className}`} style={{ aspectRatio: ratio, ...style }}>
      <style href="tralked-cover-art" precedence="default">
        {CSS}
      </style>
      {body}
    </span>
  );
}
