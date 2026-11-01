"use client";

import { useEffect, useRef } from "react";

type CountUpProps = {
  value: number;
  /** Delay before counting (ms), to land with the podium's rise. */
  delay?: number;
  duration?: number;
  className?: string;
};

const format = (n: number) => n.toLocaleString("pt-BR");

/**
 * A number that counts up from zero the first time it is on screen. The server renders the final
 * value (no JS: static), screen readers only ever get the final value, and with
 * prefers-reduced-motion it never moves.
 */
export function CountUp({ value, delay = 0, duration = 1100, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        el.textContent = format(Math.round(value * eased));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      el.textContent = format(0);
      timer = setTimeout(() => {
        frame = requestAnimationFrame(tick);
      }, delay);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        run();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      el.textContent = format(value);
    };
  }, [value, delay, duration]);

  return (
    <span className={className}>
      {/* Keyed by value: the effect rewrites this node's text, so a new value gets a fresh node. */}
      <span key={value} ref={ref} aria-hidden="true">
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
