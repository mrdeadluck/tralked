"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isOptimizedUrl, noteFailedImage, sizedImage, type ArtShape } from "@/lib/images/sized";

export type Hues = [number, number];

type GameArtProps = {
  seed: number;
  hues?: Hues;
  /** Real image (API art, article image). When set, no generated art is drawn. */
  imageUrl?: string | null;
  /** Draws the small lit figure (the preview's "knight"). */
  figure?: boolean;
  /** Brighter sky at the top. */
  light?: boolean;
  /**
   * Canvas resolution; CSS stretches it to the box. For a real image, `width` is also the widest
   * the box renders (CSS px): the CDN copy that covers it is requested (lib/images/sized.ts).
   */
  width?: number;
  height?: number;
  /** `sizes` of the real image: with it, the browser picks the CDN copy for the screen's density. */
  sizes?: string;
  /** Box shape for the CDN copy: `wide` boxes take 16:9 crops (default), `fit` uncropped sizes. */
  shape?: ArtShape;
  /** Alt text for a real image. Empty (decorative) by default: cards label their link instead. */
  alt?: string;
  /** Above-the-fold art: load the real image eagerly with high fetch priority. */
  priority?: boolean;
  /** The page's largest paint: image-optimizer copies at every width (lib/images/sized.ts). */
  optimize?: boolean;
  className?: string;
  style?: CSSProperties;
};

const DEFAULT_HUES: Hues = [218, 250];

/** Seeded PRNG (mulberry32), same as the preview so the art matches it. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generated landscape art, ported from preview/tralked-jogo.html `paint()`. */
export function paint(cv: HTMLCanvasElement, [h1, h2]: Hues, seed: number, opts: { figure?: boolean; light?: boolean }) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  const r = rng(seed);

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `hsl(${h1} 42% ${opts.light ? 30 : 20}%)`);
  g.addColorStop(0.55, `hsl(${h2} 45% 11%)`);
  g.addColorStop(1, `hsl(${h2} 55% 4%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const gx = w * (0.25 + r() * 0.5);
  const gy = h * (0.18 + r() * 0.25);
  const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.6);
  rg.addColorStop(0, `hsla(${h1} 80% 72% / .55)`);
  rg.addColorStop(0.35, `hsla(${h1} 70% 50% / .15)`);
  rg.addColorStop(1, "transparent");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `hsla(${h1} 80% 85% / ${r() * 0.5})`;
    const s = r() * 2.2;
    ctx.fillRect(r() * w, r() * h * 0.8, s, s);
  }

  for (let layer = 0; layer < 4; layer++) {
    const base = h * (0.52 + layer * 0.12);
    const amp = h * (0.16 - layer * 0.025);
    const l = 14 - layer * 3;
    ctx.fillStyle = `hsl(${h2} ${30 + layer * 5}% ${l}%)`;
    ctx.beginPath();
    ctx.moveTo(0, h);
    let x = 0;
    while (x <= w) {
      const spire = r() < 0.12 ? amp * (1.4 + r()) : amp * r();
      ctx.lineTo(x, base - spire);
      x += w * (0.025 + r() * 0.05);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  if (opts.figure) {
    const fx = w * (0.38 + r() * 0.24);
    const fy = h * 0.78;
    const s = h * 0.06;
    const lg = ctx.createRadialGradient(fx + s * 0.6, fy - s * 0.4, 0, fx + s * 0.6, fy - s * 0.4, s * 3);
    lg.addColorStop(0, "hsla(48 100% 75% / .9)");
    lg.addColorStop(1, "transparent");
    ctx.fillStyle = lg;
    ctx.fillRect(fx - s * 3, fy - s * 4, s * 7, s * 7);
    ctx.fillStyle = `hsl(${h2} 40% 3%)`;
    ctx.beginPath();
    ctx.moveTo(fx - s * 0.45, fy);
    ctx.lineTo(fx, fy - s * 1.5);
    ctx.lineTo(fx + s * 0.45, fy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fx, fy - s * 1.6, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "hsl(48 100% 80%)";
    ctx.beginPath();
    ctx.arc(fx + s * 0.6, fy - s * 0.4, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "transparent");
  vg.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Art for a game or story: the real image when there is one, otherwise the preview's generated
 * canvas art. Before hydration (or without JS) the box shows the same sky gradient as a CSS
 * background, so it never renders empty.
 */
export function GameArt({
  seed,
  hues = DEFAULT_HUES,
  imageUrl,
  figure = false,
  light = false,
  width = 600,
  height = 480,
  sizes,
  shape = "wide",
  alt = "",
  priority = false,
  optimize = false,
  className = "",
  style,
}: GameArtProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // A guessed CDN thumbnail that does not exist moves on to the next fallback (the original last).
  // Failed URLs, not a step count: a remembered PNG-only thumbnail changes the list of fallbacks.
  const [failed, setFailed] = useState<string[]>([]);
  const [h1, h2] = hues;
  const sized = imageUrl ? sizedImage(imageUrl, width, shape, optimize) : null;
  const candidates = sized ? [sized.src, ...(sized.fallbacks ?? [])] : [];
  // One optimizer copy failing means the optimizer is out for this image: skip all of its copies.
  const optimizerDown = failed.some(isOptimizedUrl);
  const usable = (url: string) => !failed.includes(url) && !(optimizerDown && isOptimizedUrl(url));
  const current = candidates.find(usable) ?? candidates[candidates.length - 1];
  const step = current ? candidates.indexOf(current) : 0;
  const canFallBack = step < candidates.length - 1;
  const fail = (url: string | undefined) => {
    if (!url) return;
    noteFailedImage(url);
    setFailed((list) => (list.includes(url) ? list : [...list, url]));
  };

  useEffect(() => {
    if (!imageUrl && ref.current) paint(ref.current, [h1, h2], seed, { figure, light });
  }, [imageUrl, h1, h2, seed, figure, light]);

  // A thumbnail (or optimizer copy) that failed before React attached onError is "complete" with no pixels.
  useEffect(() => {
    const el = img.current;
    if (!imageUrl || !el?.complete || !el.currentSrc || el.naturalWidth !== 0) return;
    if (isOptimizedUrl(el.currentSrc)) fail(el.currentSrc);
    else if (canFallBack) fail(current);
  }, [imageUrl, canFallBack, current]);

  if (imageUrl && sized) {
    // An optimizer copy the browser picked from the srcset that failed: the CDN copies only.
    const responsive = step === 0 && sizes !== undefined && !optimizerDown;
    return (
      // Hosts vary (IGDB, SteamGridDB, article credits): next/image would need remotePatterns for each,
      // and these CDNs already serve the size asked for (no image-optimizer quota spent).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={img}
        key={current}
        src={current}
        srcSet={responsive ? sized.srcSet : undefined}
        sizes={responsive ? sizes : undefined}
        width={width}
        height={height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        draggable={false}
        onError={() => {
          // The srcset candidate in use may be an optimizer copy, not `src`: blame the right one.
          const used = img.current?.currentSrc;
          if (responsive && isOptimizedUrl(used)) fail(used);
          else if (canFallBack) fail(current);
        }}
        className={`block size-full object-cover ${className}`}
        style={style}
      />
    );
  }

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      aria-hidden="true"
      className={`block size-full ${className}`}
      style={{
        background: `linear-gradient(180deg, hsl(${h1} 42% ${light ? 30 : 20}%), hsl(${h2} 45% 11%) 55%, hsl(${h2} 55% 4%))`,
        ...style,
      }}
    />
  );
}
