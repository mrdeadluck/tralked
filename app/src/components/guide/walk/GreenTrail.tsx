"use client";

import { useEffect, useRef, type ReactNode } from "react";

/*
 * The green line beside a chapter's steps: it fills with lime (with a glow and a diamond at the tip)
 * down to 55% of the window as the reader scrolls, and each step's diamond lights up once passed.
 * One passive scroll listener, at most one update per frame. With reduced motion the CSS drops the
 * transitions: the line is simply drawn up to the current point.
 */

/** Where the line's tip sits, as a share of the window height. */
const TIP = 0.55;
/** Top of a step's diamond, from the top of the step. */
const DIAMOND = 22;

export function GreenTrail({ children }: { children: ReactNode }) {
  const trailRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const trail = trailRef.current;
    const fill = fillRef.current;
    if (!trail || !fill) return;
    const steps = Array.from(trail.querySelectorAll<HTMLElement>(":scope > .wk-step"));
    let frame = 0;
    let height = -1;

    const update = () => {
      frame = 0;
      const box = trail.getBoundingClientRect();
      const tip = window.innerHeight * TIP;
      const next = Math.round(Math.max(0, Math.min(box.height, tip - box.top)));
      if (next !== height) {
        height = next;
        fill.style.height = `${next}px`;
        // Steps sit inside the trail (its offsetParent): no layout read per step.
        for (const step of steps) step.classList.toggle("passed", box.top + step.offsetTop + DIAMOND < tip);
      }
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

  return (
    <div className="wk-trail" ref={trailRef}>
      <span className="wk-fill" ref={fillRef} aria-hidden="true" />
      {children}
    </div>
  );
}
