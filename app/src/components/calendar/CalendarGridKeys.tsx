"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * Keyboard for the month grid (WAI-ARIA date grid pattern, on a plain table of links): one day
 * link in the tab order; arrows move a day / a week, Home/End go to the start/end of the week,
 * PageUp/PageDown open the previous/next month. Without JavaScript every day link is simply
 * tabbable, so nothing is lost.
 */
export function CalendarGridKeys({ children, prevHref, nextHref }: { children: ReactNode; prevHref: string | null; nextHref: string | null }) {
  const root = useRef<HTMLDivElement>(null);

  const links = () => [...(root.current?.querySelectorAll<HTMLAnchorElement>("a[data-day]") ?? [])];

  useEffect(() => {
    const all = links();
    const start = all.find((a) => a.dataset.start === "1") ?? all[0];
    for (const a of all) a.tabIndex = a === start ? 0 : -1;
  }, []);

  const move = (to: HTMLAnchorElement | undefined) => {
    if (!to) return;
    for (const a of links()) a.tabIndex = a === to ? 0 : -1;
    to.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-day]");
    if (!current) return;
    const all = links();
    const i = all.indexOf(current);
    const weekday = Number(current.dataset.weekday);
    let target: HTMLAnchorElement | undefined;
    switch (e.key) {
      case "ArrowRight":
        target = all[i + 1];
        break;
      case "ArrowLeft":
        target = all[i - 1];
        break;
      case "ArrowDown":
        target = all[Math.min(all.length - 1, i + 7)];
        break;
      case "ArrowUp":
        target = all[Math.max(0, i - 7)];
        break;
      case "Home":
        target = all[Math.max(0, i - weekday)];
        break;
      case "End":
        target = all[Math.min(all.length - 1, i + (6 - weekday))];
        break;
      case "PageUp":
      case "PageDown": {
        const href = e.key === "PageUp" ? prevHref : nextHref;
        if (!href) return;
        e.preventDefault();
        root.current?.querySelector<HTMLAnchorElement>(`a[data-month-nav="${e.key === "PageUp" ? "prev" : "next"}"]`)?.click();
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    move(target);
  };

  return (
    <div ref={root} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
