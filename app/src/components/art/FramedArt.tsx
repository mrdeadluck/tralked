import type { CSSProperties } from "react";
import { pickArt, type ArtAsset } from "@/lib/art/frame";
import { sizedImage } from "@/lib/images/sized";
import { CoverArt } from "./CoverArt";
import { GameArt, type Hues } from "./GameArt";

/*
 * A game's art in a box of a known shape (lib/art/frame `pickArt`): the image made for that shape,
 * or the clean hero with the game's logo set whole over it, or — with nothing wide — the portrait
 * cover standing whole on a stage (CoverArt). With no image at all, `fallbackUrl` (an article's own
 * picture, a company's art) or the generated art.
 */

const CSS = `
.fra { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; }
.fra-logo { position: absolute; inset: 0; margin: auto; display: block; width: auto; height: auto; max-width: 62%; max-height: 42%; object-fit: contain; filter: drop-shadow(0 6px 18px rgba(0,0,0,.75)) drop-shadow(0 1px 2px rgba(0,0,0,.6)); pointer-events: none; }
.fra-shade { position: absolute; inset: 0; background: radial-gradient(ellipse 70% 60% at 50% 50%, rgba(10,11,13,.35), transparent 75%); pointer-events: none; }
/* Lettered art shown whole: the same image blurred behind fills the few percent left over. */
.fra-wash { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(18px) saturate(1.4) brightness(.7); transform: scale(1.15); }
.fra-whole > img:not(.fra-wash), .fra-whole > canvas { position: relative; object-fit: contain !important; }
`;

type FramedArtProps = {
  art: readonly ArtAsset[] | null | undefined;
  /** The box's width / height. */
  ratio: number;
  /** `identity` for a game's card, `scene` for a news story (see pickArt). */
  mode?: "identity" | "scene";
  /** Varies the scene among equal images (an article slug). */
  pick?: string;
  /** Images already shown nearby (an article body's pictures). */
  exclude?: ReadonlySet<string>;
  /** Shown when the game has no art (an article's own image, company art). */
  fallbackUrl?: string | null;
  seed: number;
  hues?: Hues;
  /** Generated art only: draw the figure, a lighter palette (GameArt). */
  figure?: boolean;
  light?: boolean;
  alt?: string;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function FramedArt({
  art,
  ratio,
  mode = "identity",
  pick: pickSeed,
  exclude,
  fallbackUrl,
  seed,
  hues,
  figure,
  light,
  alt = "",
  width = 640,
  height,
  sizes,
  priority,
  className = "",
  style,
}: FramedArtProps) {
  const chosen = art?.length ? pickArt(art, ratio, { mode, seed: pickSeed, exclude }) : null;
  const h = height ?? Math.round(width / ratio);
  const shape = ratio < 1 ? "fit" : "wide";

  // Only a portrait cover for a wide box: stood whole on a stage, never cropped to a strip.
  if (chosen?.kind === "cover" && ratio > 1) {
    return (
      <CoverArt
        name={alt || "Capa"}
        sources={[{ url: chosen.url, wide: false }]}
        ratio={`${ratio} / 1`}
        seed={seed}
        hues={hues}
        alt={alt}
        width={width}
        sizes={sizes}
        className={className}
        style={{ height: "100%", ...style }}
      />
    );
  }

  const imageUrl = chosen?.url ?? fallbackUrl ?? null;
  const image = (
    <GameArt
      seed={seed}
      hues={hues}
      figure={figure}
      light={light}
      imageUrl={imageUrl}
      alt={chosen?.logo ? "" : alt}
      width={width}
      height={h}
      sizes={sizes}
      shape={shape}
      priority={priority}
      className={chosen?.logo || chosen?.whole ? "" : className}
      style={chosen?.position ? { objectPosition: chosen.position, ...(chosen.logo || chosen.whole ? {} : style) } : chosen?.logo || chosen?.whole ? undefined : style}
    />
  );
  if (chosen?.whole) {
    return (
      <span className={`fra fra-whole ${className}`} style={style}>
        <style href="tralked-framed-art" precedence="default">
          {CSS}
        </style>
        {/* eslint-disable-next-line @next/next/no-img-element -- the same hotlinked image, blurred */}
        <img src={sizedImage(chosen.url, Math.round(width / 4), shape).src} alt="" aria-hidden="true" className="fra-wash" loading="lazy" decoding="async" />
        {image}
      </span>
    );
  }
  if (!chosen?.logo) return image;
  return (
    <span className={`fra ${className}`} style={style}>
      <style href="tralked-framed-art" precedence="default">
        {CSS}
      </style>
      {image}
      <span className="fra-shade" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked transparent logo (Steam, SteamGridDB) */}
      <img src={chosen.logo} alt={alt} className="fra-logo" loading={priority ? "eager" : "lazy"} decoding="async" draggable={false} />
    </span>
  );
}
