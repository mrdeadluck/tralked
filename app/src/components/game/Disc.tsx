"use client";

import { useEffect, useRef } from "react";
import { paint, type Hues } from "@/components/art/GameArt";
import type { DiscLabelArt } from "@/lib/queries/game-profile";

/*
 * The game disc: printed label, clear hub, a subtle white sheen, glare.
 * The label never repeats the cover or the page's hero (`DiscLabelArt`): a screenshot of the game,
 * else its logo printed over a colour taken from the art, else the generated art. `plat` turns it
 * into the gold "platinado" disc. Spin speed comes from the `gpd-slow` / `gpd-spinning` classes.
 */

export const DISC_CSS = `
.gpd { position: relative; width: 100%; aspect-ratio: 1; border-radius: 50%; filter: drop-shadow(0 18px 30px rgba(0,0,0,.6)); }
.gpd canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
.gpd-spin { position: absolute; inset: 0; border-radius: 50%; }
.gpd.gpd-spinning .gpd-spin { animation: gpd-spin 1.1s linear infinite; }
.gpd.gpd-slow .gpd-spin { animation: gpd-spin 14s linear infinite; }
@keyframes gpd-spin { to { rotate: 360deg; } }
/* A subtle white sheen on the data ring (no rainbow): two soft highlights that turn with the disc. */
.gpd-sheen { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; mix-blend-mode: screen; opacity: .5;
  background: conic-gradient(from 40deg, transparent, rgba(255,255,255,.18), transparent 25%, transparent 50%, rgba(255,255,255,.14), transparent 75%);
  -webkit-mask: radial-gradient(circle, transparent 0 17%, #000 18% 33%, transparent 35%);
  mask: radial-gradient(circle, transparent 0 17%, #000 18% 33%, transparent 35%); }
.gpd-glare { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; background: linear-gradient(135deg, rgba(255,255,255,.22), transparent 40%, transparent 60%, rgba(255,255,255,.08)); }
.gpd.gpd-plat .gpd-sheen { opacity: .7; background: conic-gradient(from 0deg, rgba(255,215,120,0), rgba(255,215,120,.45), rgba(255,240,200,.35), rgba(255,200,100,.45), rgba(255,215,120,0)); -webkit-mask: none; mask: none; }
@media (prefers-reduced-motion: reduce) { .gpd .gpd-spin { animation: none !important; } }
`;

type DiscArt = { hues: Hues; seed: number; art: DiscLabelArt; name: string; label: string; plat: boolean };
type Rgb = [number, number, number];

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** HSL (0-360, 0-1, 0-1) to RGB 0-255. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * The art's dominant tone: the average of its pixels, pulled to a darker, saturated label colour.
 * Null when the image cannot be read (no CORS on its host).
 */
function sampleColor(image: HTMLImageElement): Rgb | null {
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 16;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      // Colourful pixels count more than greys, near-black and near-white ones.
      const weight = 0.15 + (max - min) / 255;
      if (max < 18 || min > 240) continue;
      r += d[i] * weight;
      g += d[i + 1] * weight;
      b += d[i + 2] * weight;
      n += weight;
    }
    if (n === 0) return null;
    const scale = 0.62; // a label tone, dark enough for the light logo and text on top
    return [Math.round((r / n) * scale), Math.round((g / n) * scale), Math.round((b / n) * scale)];
  } catch {
    return null;
  }
}

const rgb = ([r, g, b]: Rgb, a = 1) => `rgba(${r},${g},${b},${a})`;

/** Draws the label art into the ring between the hub and the rim, then the hub, rims and text. */
function paintDisc(cv: HTMLCanvasElement, art: DiscArt, image: HTMLImageElement | null, tint: Rgb | null) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const c = w / 2;
  const R = c * 0.985;
  ctx.clearRect(0, 0, w, w);
  const kind = art.art.kind;

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.arc(c, c, R * 0.34, 0, Math.PI * 2, true);
  ctx.clip();
  if (kind === "shot" && image) {
    // Cover-fit the screenshot into the square, from its middle.
    const scale = Math.max(w / image.naturalWidth, w / image.naturalHeight);
    const iw = image.naturalWidth * scale;
    const ih = image.naturalHeight * scale;
    ctx.drawImage(image, (w - iw) / 2, (w - ih) / 2, iw, ih);
    ctx.fillStyle = "rgba(6,6,8,.32)";
    ctx.fillRect(0, 0, w, w);
  } else if (kind === "logo") {
    // A printed label: the art's colour, a soft sheen, and the game's logo across the upper band.
    const base = tint ?? hslToRgb(art.hues[0], 0.45, 0.3);
    const fill = ctx.createRadialGradient(c, c * 0.7, R * 0.2, c, c, R);
    fill.addColorStop(0, rgb(base.map((v) => Math.min(255, v + 34)) as Rgb));
    fill.addColorStop(1, rgb(base.map((v) => Math.round(v * 0.55)) as Rgb));
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, w);
    if (image && image.naturalWidth > 0) {
      const scale = Math.min((R * 1.2) / image.naturalWidth, (R * 0.4) / image.naturalHeight);
      const lw = image.naturalWidth * scale;
      const lh = image.naturalHeight * scale;
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 14;
      ctx.drawImage(image, c - lw / 2, c - R * 0.6 - lh / 2, lw, lh);
      ctx.shadowBlur = 0;
    }
  } else {
    const generated = document.createElement("canvas");
    generated.width = generated.height = w;
    paint(generated, art.hues, art.seed, { figure: true, light: true });
    ctx.drawImage(generated, 0, 0);
  }
  if (art.plat) {
    ctx.fillStyle = "rgba(255,205,110,.28)";
    ctx.fillRect(0, 0, w, w);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, R - 1, 0, Math.PI * 2);
  ctx.stroke();

  // Clear centre ring and hub.
  ctx.beginPath();
  ctx.arc(c, c, R * 0.34, 0, Math.PI * 2);
  ctx.arc(c, c, R * 0.2, 0, Math.PI * 2, true);
  const hub = ctx.createRadialGradient(c, c, R * 0.2, c, c, R * 0.34);
  hub.addColorStop(0, "rgba(210,215,225,.55)");
  hub.addColorStop(0.5, "rgba(160,165,175,.25)");
  hub.addColorStop(1, "rgba(220,225,235,.5)");
  ctx.fillStyle = hub;
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = 1.5;
  for (const rr of [R * 0.34, R * 0.27, R * 0.2]) {
    ctx.beginPath();
    ctx.arc(c, c, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Label text: the name shrinks until it fits the upper band.
  const sans = cssVar("--font-archivo", "Archivo");
  ctx.save();
  ctx.translate(c, c);
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(243,241,234,.94)";
  let size = w * 0.075;
  const title = art.name.toUpperCase();
  ctx.font = `900 ${size}px ${sans}, sans-serif`;
  while (ctx.measureText(title).width > R * 1.45 && size > w * 0.03) {
    size -= 2;
    ctx.font = `900 ${size}px ${sans}, sans-serif`;
  }
  // A printed logo already names the game; a screenshot or the generated art get the name.
  if (kind !== "logo" || !image) ctx.fillText(title, 0, -R * 0.52);
  // The print line: Archivo condensed, spaced out (no monospace as decoration).
  const c2 = ctx as CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string };
  c2.fontStretch = "condensed";
  c2.letterSpacing = `${Math.round(w * 0.004)}px`;
  ctx.font = `800 ${w * 0.03}px ${sans}, sans-serif`;
  ctx.fillStyle = art.plat ? "rgba(255,215,140,.95)" : "rgba(198,244,50,.95)";
  ctx.fillText(art.label, 0, R * 0.58);
  ctx.restore();
}

export function Disc({
  hues,
  seed,
  art,
  name,
  label,
  plat = false,
  className = "",
}: DiscArt & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [h1, h2] = hues;
  const kind = art.kind;
  const imageUrl = art.kind === "generated" ? null : art.url;
  const tintUrl = art.kind === "logo" ? art.tintFrom : null;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let alive = true;
    // Rebuilt from the primitive props, so a new `art` object with the same content does not repaint.
    const labelArt: DiscLabelArt =
      imageUrl === null
        ? { kind: "generated" }
        : kind === "logo"
          ? { kind: "logo", url: imageUrl, tintFrom: tintUrl }
          : { kind: "shot", url: imageUrl };
    const disc: DiscArt = { hues: [h1, h2], seed, art: labelArt, name, label, plat };
    let image: HTMLImageElement | null = null;
    let tint: Rgb | null = null;
    const loaded = () => (image?.complete && image.naturalWidth ? image : null);
    const draw = () => alive && paintDisc(cv, disc, loaded(), tint);
    draw();
    if (imageUrl) {
      image = new Image();
      image.decoding = "async";
      image.onload = draw;
      image.src = imageUrl;
    }
    if (tintUrl) {
      // Only its colour is read: the label never prints this art. Needs CORS (Steam's CDN sends it).
      const source = new Image();
      source.crossOrigin = "anonymous";
      source.decoding = "async";
      source.onload = () => {
        tint = sampleColor(source);
        draw();
      };
      source.src = tintUrl;
    }
    // Repaint once the fonts are in, so the label uses Archivo.
    void document.fonts?.ready.then(draw);
    return () => {
      alive = false;
    };
  }, [h1, h2, seed, kind, imageUrl, tintUrl, name, label, plat]);

  return (
    <div className={`gpd ${plat ? "gpd-plat" : ""} ${className}`}>
      <style href="tralked-game-disc" precedence="default">
        {DISC_CSS}
      </style>
      <div className="gpd-spin">
        <canvas ref={ref} width={600} height={600} aria-hidden="true" />
        <div className="gpd-sheen" />
      </div>
      <div className="gpd-glare" />
    </div>
  );
}
