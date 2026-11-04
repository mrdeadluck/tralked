"use client";

import { useEffect, useState } from "react";

/*
 * "Voltar ao topo" on a guide page (both formats): a small floating button at the bottom right,
 * shown once the visitor scrolled past 1.5 window heights. Smooth, or instant under reduced motion;
 * focus goes to the page's heading, so a keyboard user starts over from the top. It sits at the
 * bottom, so it never covers the walkthrough's slim bar under the header, and it rises above the
 * soundtrack mini player (and its video) where they would overlap it (phones).
 */

/** Shown below this many window heights of scroll. */
const AFTER = 1.5;
/** Distance from the window's edges, the button's size and the gap kept above the player (px). */
const EDGE = 16;
const SIZE = 44;
const GAP = 8;

/** Bottom offset that keeps the button clear of the soundtrack player where they overlap. */
function bottomOffset(): number {
  const left = window.innerWidth - EDGE - SIZE;
  let bottom = EDGE;
  for (const el of document.querySelectorAll<HTMLElement>(".wk-ost, .wk-ost-video:not([hidden])")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.right <= left) continue;
    bottom = Math.max(bottom, Math.round(window.innerHeight - box.top + GAP));
  }
  return bottom;
}

export function BackToTop() {
  const [shown, setShown] = useState(false);
  const [bottom, setBottom] = useState(EDGE);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShown(window.scrollY > window.innerHeight * AFTER);
      setBottom(bottomOffset());
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    // The player opens, plays (its video shows) and closes on clicks.
    const events = ["scroll", "resize", "click"] as const;
    events.forEach((e) => window.addEventListener(e, schedule, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, schedule));
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  if (!shown) return null;
  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    const heading = document.querySelector<HTMLElement>("h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  };
  return (
    <button
      type="button"
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
      onClick={toTop}
      style={{ bottom }}
      className="tk-cut-b fixed right-4 z-30 grid size-11 cursor-pointer place-items-center border border-line-2 bg-surface-2/95 text-lg font-black text-acc shadow-[0_8px_24px_rgb(0_0_0/0.45)] backdrop-blur hover:border-acc focus-visible:border-acc"
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}
