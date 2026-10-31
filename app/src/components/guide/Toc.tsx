"use client";

import { useEffect, useState } from "react";

export type TocItem = { id: string; label: string; count?: string | number };

/** "Neste guia" table of contents: smooth-scrolls to a section and highlights the one in view. */
export function Toc({ items }: { items: TocItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0 || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(entry.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  function scrollTo(id: string) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <ul className="m-0 list-none p-0 pt-2">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => scrollTo(item.id)}
            aria-current={current === item.id ? "location" : undefined}
            className={`flex w-full cursor-pointer justify-between gap-2 border-0 border-l-2 bg-transparent px-3 py-[9px] text-left font-mono text-xs tracking-[0.04em] hover:bg-hover ${
              current === item.id
                ? "border-l-acc text-acc"
                : "border-l-line-2 text-text-3 hover:text-text"
            }`}
          >
            {item.label}
            {item.count !== undefined && item.count !== "" ? (
              <small className="text-dim-2">{item.count}</small>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
