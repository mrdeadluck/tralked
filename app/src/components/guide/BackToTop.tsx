"use client";

import { useEffect, useState } from "react";

/*
 * "Voltar ao topo" on a guide page (both formats): a small floating button at the bottom right,
 * shown once the visitor scrolled past 1.5 window heights. Smooth, or instant under reduced motion.
 * It sits at the bottom, so it never covers the walkthrough's slim bar under the header.
 */

/** Shown below this many window heights of scroll. */
const AFTER = 1.5;

export function BackToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShown(window.scrollY > window.innerHeight * AFTER);
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
  }, []);

  if (!shown) return null;
  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <button
      type="button"
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
      onClick={toTop}
      className="tk-cut-b fixed right-4 bottom-4 z-30 grid size-11 cursor-pointer place-items-center border border-line-2 bg-surface-2/95 text-lg font-black text-acc shadow-[0_8px_24px_rgb(0_0_0/0.45)] backdrop-blur hover:border-acc focus-visible:border-acc"
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}
