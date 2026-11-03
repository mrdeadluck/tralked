"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * Behind the walkthrough: up to 4 official screenshots, darkened and slightly blurred, swapping with
 * a 1.4 s fade and drifting up to 70 px slower than the content (by share of the page). Each chapter
 * goes through all of them: the image follows the share of the current chapter read, from the top
 * of its scene to the end of its last step, and starts over at the next chapter. Before the first
 * chapter it is the first image. The chapters are read from the page (`.wk-chap`), nothing more is
 * sent. Only the first image is sent with the page; the others are added once motion is allowed.
 * With `prefers-reduced-motion` the first image stays, still.
 */

const MAX_IMAGES = 4;
const PARALLAX_PX = 70;
/** Where the reading is: this share of the window height (as the journey and the green line). */
const READ_LINE = 0.55;

type Span = { start: Element; end: Element };

/** Each chapter on the page, from its scene to its last step. */
function chapterSpans(): Span[] {
  return Array.from(document.querySelectorAll(".wk-chap")).map((chapter) => {
    const steps = chapter.querySelectorAll(".wk-step");
    return { start: chapter.querySelector(".wk-scene") ?? chapter, end: steps[steps.length - 1] ?? chapter };
  });
}

/** Share of the current chapter read at the reading line (0 before the first chapter). */
function chapterShare(spans: Span[], line: number): number {
  let share = 0;
  for (const { start, end } of spans) {
    const top = start.getBoundingClientRect().top;
    if (top > line) break;
    const bottom = end.getBoundingClientRect().bottom;
    share = bottom > top ? Math.min(1, (line - top) / (bottom - top)) : 1;
  }
  return share;
}

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
    const spans = chapterSpans();
    let frame = 0;
    const update = () => {
      frame = 0;
      const share = chapterShare(spans, window.innerHeight * READ_LINE);
      setCurrent(Math.min(all.length - 1, Math.floor(share * all.length)));
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
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
