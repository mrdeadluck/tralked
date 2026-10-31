"use client";

import { useEffect, useRef } from "react";
import { paint, type Hues } from "@/components/art/GameArt";

/*
 * The game disc of preview/tralked-jogo.html: printed label (the game's real hero/cover art when
 * there is one, otherwise the generated art), clear hub, iridescent rings, glare. `plat` turns
 * it into the gold "platinado" disc. Spin speed comes from the `gpd-slow` / `gpd-spinning` classes.
 */

export const DISC_CSS = `
.gpd { position: relative; width: 100%; aspect-ratio: 1; border-radius: 50%; filter: drop-shadow(0 18px 30px rgba(0,0,0,.6)); }
.gpd canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
.gpd-spin { position: absolute; inset: 0; border-radius: 50%; }
.gpd.gpd-spinning .gpd-spin { animation: gpd-spin 1.1s linear infinite; }
.gpd.gpd-slow .gpd-spin { animation: gpd-spin 14s linear infinite; }
@keyframes gpd-spin { to { rotate: 360deg; } }
.gpd-iris { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; mix-blend-mode: screen; opacity: .55;
  background: conic-gradient(from 20deg, rgba(255,60,160,0), rgba(255,60,160,.35), rgba(60,220,255,.35), rgba(200,255,90,.3), rgba(255,200,60,.3), rgba(160,90,255,.35), rgba(255,60,160,0));
  -webkit-mask: radial-gradient(circle, transparent 0 17%, #000 18% 34%, transparent 36% 62%, #000 64% 100%);
  mask: radial-gradient(circle, transparent 0 17%, #000 18% 34%, transparent 36% 62%, #000 64% 100%); transition: opacity .4s; }
.gpd-glare { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; background: linear-gradient(135deg, rgba(255,255,255,.22), transparent 40%, transparent 60%, rgba(255,255,255,.08)); }
.gpd.gpd-plat .gpd-iris { opacity: .9; background: conic-gradient(from 0deg, rgba(255,215,120,0), rgba(255,215,120,.6), rgba(255,255,255,.5), rgba(255,190,90,.6), rgba(255,240,200,.5), rgba(255,215,120,0)); -webkit-mask: none; mask: none; }
@media (prefers-reduced-motion: reduce) { .gpd .gpd-spin { animation: none !important; } }
`;

type DiscArt = { hues: Hues; seed: number; imageUrl: string | null; name: string; label: string; plat: boolean };

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Draws the label art into the ring between the hub and the rim, then the hub, rims and text. */
function paintDisc(cv: HTMLCanvasElement, art: DiscArt, image: HTMLImageElement | null) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const w = cv.width;
  const c = w / 2;
  const R = c * 0.985;
  ctx.clearRect(0, 0, w, w);

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.arc(c, c, R * 0.34, 0, Math.PI * 2, true);
  ctx.clip();
  if (image) {
    // Cover-fit the real art into the square. A portrait cover is framed from its upper part
    // (where the logo and the character sit) instead of its middle.
    const scale = Math.max(w / image.naturalWidth, w / image.naturalHeight);
    const iw = image.naturalWidth * scale;
    const ih = image.naturalHeight * scale;
    const y = ih > iw ? -(ih - w) * 0.2 : (w - ih) / 2;
    ctx.drawImage(image, (w - iw) / 2, y, iw, ih);
    ctx.fillStyle = "rgba(6,6,8,.28)";
    ctx.fillRect(0, 0, w, w);
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
  const mono = cssVar("--font-jetbrains-mono", "monospace");
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
  // Real art already carries the game's logo: printing the name over it would collide.
  if (!image) ctx.fillText(title, 0, -R * 0.52);
  ctx.font = `500 ${w * 0.025}px ${mono}, monospace`;
  ctx.fillStyle = art.plat ? "rgba(255,215,140,.95)" : "rgba(198,244,50,.95)";
  ctx.fillText(art.label, 0, R * 0.58);
  ctx.restore();
}

export function Disc({
  hues,
  seed,
  imageUrl,
  name,
  label,
  plat = false,
  className = "",
}: DiscArt & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [h1, h2] = hues;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let alive = true;
    const art: DiscArt = { hues: [h1, h2], seed, imageUrl, name, label, plat };
    const draw = (image: HTMLImageElement | null) => alive && paintDisc(cv, art, image);
    draw(null);
    let image: HTMLImageElement | null = null;
    if (imageUrl) {
      image = new Image();
      image.decoding = "async";
      image.onload = () => draw(image);
      image.src = imageUrl;
    }
    // Repaint once the fonts are in, so the label uses Archivo and JetBrains Mono.
    void document.fonts?.ready.then(() => draw(image?.complete && image.naturalWidth ? image : null));
    return () => {
      alive = false;
    };
  }, [h1, h2, seed, imageUrl, name, label, plat]);

  return (
    <div className={`gpd ${plat ? "gpd-plat" : ""} ${className}`}>
      <style href="tralked-game-disc" precedence="default">
        {DISC_CSS}
      </style>
      <div className="gpd-spin">
        <canvas ref={ref} width={600} height={600} aria-hidden="true" />
        <div className="gpd-iris" />
      </div>
      <div className="gpd-glare" />
    </div>
  );
}
