"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * Behind the walkthrough: up to 4 official screenshots, darkened and slightly blurred, swapping with
 * a 1.4 s fade as the reader scrolls (by share of the page) and drifting up to 70 px slower than the
 * content. Only the first image is sent with the page; the others are added once motion is allowed.
 * With `prefers-reduced-motion` the first image stays, still.
 */

const MAX_IMAGES = 4;
const PARALLAX_PX = 70;

const cssUrl = (url: string) => `url("${url.replace(/"/g, "%22")}")`;

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia?.(REDUCE_QUERY);
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}
/** Motion only when the browser says the reader does not ask to reduce it. */
const readMotion = () => window.matchMedia?.(REDUCE_QUERY).matches === false;

export function BackdropFader({ images }: { images: string[] }) {
  const all = images.slice(0, MAX_IMAGES);
  const motion = useSyncExternalStore(subscribeMotion, readMotion, () => false) && all.length > 1;
  const [current, setCurrent] = useState(0);
  const layers = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!motion) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      setCurrent(Math.min(all.length - 1, Math.floor(p * all.length)));
      const transform = `translateY(${(-p * PARALLAX_PX).toFixed(1)}px) scale(${(1.04 + p * 0.06).toFixed(3)})`;
      for (const layer of layers.current) if (layer) layer.style.transform = transform;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [motion, all.length]);

  if (all.length === 0) return null;
  const shown = motion ? all : all.slice(0, 1);
  return (
    <div className="wk-bgfx" aria-hidden="true">
      {shown.map((url, i) => (
        <i
          key={url}
          ref={(el) => {
            layers.current[i] = el;
          }}
          className={i === current ? "on" : undefined}
          style={{ backgroundImage: cssUrl(url) }}
        />
      ))}
    </div>
  );
}
