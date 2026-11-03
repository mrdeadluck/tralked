"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { JourneyRow, useJourney } from "./journey";
import { useWalkProgress } from "./progress";
import { useJourneyLit } from "./resume-state";
import { SpoilerToggle } from "./SpoilerToggle";

/*
 * Journey of chapters under the page's top: a diamond per chapter with the visitor's ticks and the
 * missables, a divider where a new phase of the roadmap starts (the cleanup, for one). Once it
 * scrolls away it becomes a thin bar pinned under the site header: the current chapter, a progress
 * segment per chapter, the overall count and the spoiler switch. Same on phones.
 */

/** Where the current chapter is read: the chapter whose top passed this share of the window. */
const READ_LINE = 0.55;

export function WalkJourney() {
  const chapters = useJourney();
  const { doneCount, user } = useWalkProgress();
  const lit = useJourneyLit();
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
          <JourneyRow chapters={chapters} counts={counts} user={Boolean(user)} current={current} currentAs="location" lit={lit} />
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
