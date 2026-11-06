/*
 * Scroll math of the parallax backdrop (ParallaxBackdrop.tsx), ported from the approved preview
 * (tralked-parallax-preview/dist/app.js). One change from the preview: there the whole sequence was
 * stretched over the page's scroll height, which makes a short page flash every layer at once and a
 * long one leave the background empty for screens. Here a stage is a fixed slice of the viewport
 * (half again the preview home's pace, which Lucas found too quick: 0.9 screen per stage on desktop,
 * 1.6 on phones), and the lime
 * ribbons keep coming back every 1.3 stages after the cast is done, so any page length reads the same.
 */

/** Stage where the last character (Captain Price) peaks. */
export const END_STAGE = 5.25;

/** Phones and narrow tablets: the preview's mobile layout and trajectories. */
export const MOBILE_MAX_WIDTH = 800;

/** Scroll, in viewport heights, that advances one stage (preview home: 0.6 / 1.27; slowed 11-06). */
const STAGE_VIEWPORTS = { desktop: 0.9, mobile: 1.6 } as const;

/** Never squeeze a stage below this many viewport heights, even on a short page. */
const MIN_STAGE_VIEWPORTS = 0.5;

export type BackdropMode = "full" | "ribbons";

/*
 * Home, Notícias and the Comunidade pages (Fórum, Galeria, Família) get the whole cast; every other
 * page keeps the lime ribbons and the wordmark/emblem passages, without the characters. A news article is its own reading page, so it gets the ribbons.
 */
const FULL_PREFIXES = ["/forum", "/galeria", "/familia"];

export function backdropModeFor(pathname: string): BackdropMode {
  if (pathname === "/" || pathname === "/noticias") return "full";
  return FULL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ? "full" : "ribbons";
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => {
  const c = clamp(x);
  return c * c * (3 - 2 * c);
};

/**
 * Scroll pixels per stage. With the cast, a page shorter than the full sequence still gets to see it
 * end (the preview's behaviour), down to MIN_STAGE_VIEWPORTS so nothing flashes by.
 */
export function stagePixels(viewport: number, mobile: boolean, mode: BackdropMode, maxScroll: number): number {
  const fixed = viewport * (mobile ? STAGE_VIEWPORTS.mobile : STAGE_VIEWPORTS.desktop);
  if (mode !== "full") return fixed;
  return Math.max(viewport * MIN_STAGE_VIEWPORTS, Math.min(fixed, maxScroll / END_STAGE));
}

/** Peak stage of ribbon k: the preview's 0, 1.25, 2.55, 3.85, 5.15, then every 1.3 stages. */
export function ribbonStage(k: number): number {
  return k === 0 ? 0 : 1.25 + 1.3 * (k - 1);
}

/**
 * Two ribbon elements are enough (a ribbon fades within 1.2 stages of its peak; same-parity ribbons
 * are 2.6 apart, so a slot never holds two at once): slot 0 shows the even ribbons, slot 1 the odd
 * ones, which keeps the preview's alternating tilt.
 */
export function ribbonForSlot(t: number, slot: 0 | 1): number {
  const approx = t < 1.25 ? 0 : Math.round((t - 1.25) / 1.3) + 1;
  let best = -1;
  for (let k = Math.max(0, approx - 2); k <= approx + 2; k++) {
    if (k % 2 !== slot) continue;
    if (best < 0 || Math.abs(t - ribbonStage(k)) < Math.abs(t - ribbonStage(best))) best = k;
  }
  return best;
}

export type Pose = { transform: string; opacity: number };

/** A character's pose at stage t (preview: y = −d·h·0.40/0.47/0.31, x = ±27/10 px per stage). */
export function figurePose(t: number, center: number, opts: { side: "left" | "right"; back: boolean; viewport: number; mobile: boolean }): Pose {
  const d = t - center;
  const opacity = 1 - smooth((Math.abs(d) - 0.2) / 1.13);
  const y = -d * opts.viewport * (opts.mobile ? 0.31 : opts.back ? 0.4 : 0.47);
  const x = d * (opts.side === "left" ? 1 : -1) * (opts.mobile ? 10 : 27);
  const scale = 1.02 - clamp(d, -1.5, 1.5) * 0.045;
  return { transform: `translate3d(${x}px,${y}px,0) scale(${scale})`, opacity };
}

/**
 * How far from its peak (in stages) a ribbon fades out. Wider than the preview's 0.9 so the next
 * ribbon is already coming in while the last one leaves (a slower handoff, Lucas 11-06).
 */
const RIBBON_FADE = 1.2;

/** Ribbon k's pose at stage t: rises and slides across, tilted −13° (even) or +13° (odd). */
export function ribbonPose(t: number, k: number, mobile: boolean): Pose {
  const d = t - ribbonStage(k);
  const direction = k % 2 ? 1 : -1;
  const opacity = 0.48 * (1 - smooth(Math.abs(d) / RIBBON_FADE));
  return {
    transform: `translate3d(${direction * d * (mobile ? 30 : 70)}px,${-d * (mobile ? 30 : 60)}px,0) rotate(${direction * 13}deg)`,
    opacity,
  };
}

/**
 * Wordmark and emblem fade in on the passages between ribbons: the preview's 0.65 (word), 1.95
 * (emblem), 3.25 (word), 4.55 (emblem), then the same alternation every 1.3 stages for as long as
 * the page scrolls (ribbon-only pages included).
 */
export function markPulses(t: number): { word: number; symbol: number } {
  const n = Math.max(0, Math.round((t - 0.65) / 1.3));
  const pulse = (k: number) => (k < 0 ? 0 : Math.exp(-Math.pow((t - (0.65 + 1.3 * k)) / 0.43, 2)));
  const [even, odd] = n % 2 === 0 ? [n, n - 1] : [n - 1, n];
  return { word: Math.max(pulse(even), pulse(even + 2)), symbol: Math.max(pulse(odd), pulse(odd + 2)) };
}

/** Slow drift of the emblem, wordmark and atmosphere; held once the cast is over. */
export function depthAt(t: number): number {
  return (clamp(t, 0, END_STAGE) / END_STAGE) * 4;
}
