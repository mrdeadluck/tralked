"use client";

import { useEffect, useRef } from "react";
import { JourneyRow, useJourney } from "./journey";
import { useWalkProgress } from "./progress";

/*
 * The journey again, compact, in the gap before a chapter's scene (from chapter 2 on): the chapter
 * about to start is the current one, the ones before it are passed, each diamond links to its
 * chapter. It reads the chapters the page sent once (JourneyProvider) and carries only its number.
 * On a narrow screen the row scrolls sideways to the chapter about to start, without animation.
 */

export function ChapterTimeline({ at }: { at: number }) {
  const chapters = useJourney();
  const { doneCount, user } = useWalkProgress();
  const rowRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    const item = row?.children[at];
    if (!row || !item) return;
    const box = row.getBoundingClientRect();
    const own = item.getBoundingClientRect();
    // Centre the current diamond (the browser clamps to the row's ends).
    row.scrollLeft += own.left - box.left - (box.width - own.width) / 2;
  }, [at]);

  const next = chapters[at];
  if (!next) return null;
  return (
    <nav className="wk-journey wk-jgap" aria-label={`Jornada: começa o capítulo ${at + 1} de ${chapters.length}, ${next.title}`}>
      <div className="wk-jr-in">
        <JourneyRow
          ref={rowRef}
          chapters={chapters}
          counts={chapters.map((c) => doneCount(c.refs))}
          user={Boolean(user)}
          current={at}
          passed
          currentAs="step"
        />
      </div>
    </nav>
  );
}
