"use client";

import type { ReactNode } from "react";
import { useRef } from "react";

/**
 * The only client part of a radar block: pointing at a list row or at a tip of the chart marks
 * every element with the same `data-k` (class "hl"), so the two find each other. The markup is
 * rendered on the server; this only toggles a class.
 */
export function RadarHover({ className, children }: { className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<string | null>(null);

  const mark = (key: string | null) => {
    if (key === current.current) return;
    current.current = key;
    const el = root.current;
    if (!el) return;
    el.querySelectorAll(".hl").forEach((node) => node.classList.remove("hl"));
    if (key) el.querySelectorAll(`[data-k="${CSS.escape(key)}"]`).forEach((node) => node.classList.add("hl"));
  };
  const keyOf = (target: EventTarget) =>
    target instanceof Element ? (target.closest("[data-k]")?.getAttribute("data-k") ?? null) : null;

  return (
    <div
      ref={root}
      className={className}
      onPointerOver={(event) => mark(keyOf(event.target))}
      onPointerLeave={() => mark(null)}
      onFocus={(event) => mark(keyOf(event.target))}
      onBlur={() => mark(null)}
    >
      {children}
    </div>
  );
}
