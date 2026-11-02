"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

/** Day of the month to focus after Page Up / Page Down opened another month. */
const FOCUS_KEY = "tralked:calendar-focus-day";

/**
 * Keyboard for the month grid (WAI-ARIA date grid pattern, on a plain table of links): one day
 * link in the tab order; arrows move a day / a week, Home/End go to the start/end of the week,
 * PageUp/PageDown open the previous/next month and keep the focus on the same day there. Without
 * JavaScript every day link is simply tabbable, so nothing is lost. Keyed by month by its parent,
 * so a client navigation to another month starts fresh.
 */
export function CalendarGridKeys({
  children,
  month,
  prevMonth,
  nextMonth,
}: {
  children: ReactNode;
  /** "2026-10": this grid's month; prev/next are null outside the calendar's range. */
  month: string;
  prevMonth: string | null;
  nextMonth: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);

  const links = () => [...(root.current?.querySelectorAll<HTMLAnchorElement>("a[data-day]") ?? [])];

  useEffect(() => {
    const all = links();
    let wanted: number | null = null;
    try {
      // Left in place for a few seconds: the month may mount twice (its public fallback first).
      const stored = JSON.parse(sessionStorage.getItem(FOCUS_KEY) ?? "null") as { month: string; day: number; at: number } | null;
      if (stored && stored.month === month && Date.now() - stored.at < 5_000) wanted = stored.day;
    } catch {
      // Storage blocked or garbled: start on today / the 1st.
    }
    const byDay = wanted ? all[Math.min(all.length, wanted) - 1] : undefined;
    const start = byDay ?? all.find((a) => a.dataset.start === "1") ?? all[0];
    for (const a of all) a.tabIndex = a === start ? 0 : -1;
    if (byDay) byDay.focus();
  }, [month]);

  // The timeline keeps one week open: a day link (or a shared #dia- link) opens its week first, so
  // the browser has something to scroll to.
  useEffect(() => {
    const reveal = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const target = id.startsWith("dia-") ? document.getElementById(id) : null;
      const week = target?.closest("details");
      if (!target || !week || week.open) return;
      week.open = true;
      target.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-day]");
    const id = link?.hash.slice(1);
    const week = id ? document.getElementById(id)?.closest("details") : null;
    // Opened before the default jump to the fragment, which then lands on the day.
    if (week && !week.open) week.open = true;
  };

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
        const target = e.key === "PageUp" ? prevMonth : nextMonth;
        if (!target) return;
        e.preventDefault();
        try {
          sessionStorage.setItem(FOCUS_KEY, JSON.stringify({ month: target, day: i + 1, at: Date.now() }));
        } catch {
          // Storage blocked: the new month starts on its 1st.
        }
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
    <div ref={root} onKeyDown={onKeyDown} onClick={onClick}>
      {children}
    </div>
  );
}
