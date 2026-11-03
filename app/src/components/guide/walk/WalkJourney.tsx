"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useWalkProgress } from "./progress";
import { SpoilerToggle } from "./SpoilerToggle";

/*
 * Journey of chapters under the page's top: a diamond per chapter with the visitor's ticks and the
 * missables, a divider where a new phase of the roadmap starts (the cleanup, for one). Once it
 * scrolls away it becomes a thin bar pinned under the site header: the current chapter, a progress
 * segment per chapter, the overall count and the spoiler switch. Same on phones.
 */

export type JourneyChapter = {
  key: string;
  title: string;
  /** Roadmap phase (a divider marks where it changes). */
  phase: number;
  /** Refs of the chapter's items (view.ts). */
  refs: string[];
  missables: number;
};

/** Where the current chapter is read: the chapter whose top passed this share of the window. */
const READ_LINE = 0.55;

export function WalkJourney({ chapters }: { chapters: JourneyChapter[] }) {
  const { doneCount, user } = useWalkProgress();
  const navRef = useRef<HTMLElement>(null);
  const [slim, setSlim] = useState(false);
  const [top, setTop] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const sections = chapters.map((c) => document.getElementById(`cap-${c.key}`));
    let frame = 0;
    const update = () => {
      frame = 0;
      // The bar sits right under the sticky site header.
      const header = document.querySelector("body > header, header.sticky");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      setTop(headerBottom);
      setSlim(nav.getBoundingClientRect().bottom < headerBottom);
      const line = window.innerHeight * READ_LINE;
      let at = 0;
      sections.forEach((section, i) => {
        if (section && section.getBoundingClientRect().top < line) at = i;
      });
      setCurrent(at);
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
  }, [chapters]);

  const all = chapters.flatMap((c) => c.refs);
  const counts = chapters.map((c) => doneCount(c.refs));
  const here = chapters[current];

  return (
    <>
      <nav ref={navRef} className="wk-journey" aria-label="Capítulos do detonado">
        <div className="wk-jr-in">
          <ol className="wk-jr">
            {chapters.map((c, i) => {
              const full = c.refs.length > 0 && counts[i] === c.refs.length;
              const cls = ["wk-hn", i === current ? "c" : "", full ? "f" : "", i > 0 && c.phase !== chapters[i - 1].phase ? "ph" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={c.key} className={cls}>
                  <a href={`#cap-${c.key}`} aria-current={i === current ? "location" : undefined}>
                    <span className="dot" aria-hidden="true" />
                    <span className="t">{c.title}</span>
                    <span className="s">
                      {user ? `${counts[i]}/${c.refs.length}` : `${c.refs.length} itens`}
                      {c.missables > 0 ? <span className="w"> · {c.missables} ⚠</span> : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
          <SpoilerToggle />
        </div>
      </nav>
      <div className={slim ? "wk-slim on" : "wk-slim"} style={{ top }} aria-hidden={!slim} inert={!slim}>
        <div className="wk-slim-in">
          <b>{here ? `${current + 1}. ${here.title}` : null}</b>
          <span className="wk-segs" aria-hidden="true">
            {chapters.map((c, i) => (
              <i
                key={c.key}
                className={i === current ? "c" : undefined}
                style={{ "--p": `${c.refs.length > 0 ? (counts[i] / c.refs.length) * 100 : 0}%` } as CSSProperties}
              />
            ))}
          </span>
          <span className="wk-pct">
            {doneCount(all)} / {all.length}
          </span>
          <SpoilerToggle />
        </div>
      </div>
    </>
  );
}
