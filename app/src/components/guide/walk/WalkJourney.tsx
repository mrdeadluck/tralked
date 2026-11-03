import type { Walkthrough } from "@/lib/content/walkthrough-schema";

/*
 * Journey of chapters under the page's top (stub). The full version, with diamonds, counts and
 * the thin bar pinned to the top while scrolling, replaces this one.
 */
export function WalkJourney({ walkthrough }: { walkthrough: Walkthrough }) {
  return (
    <nav aria-label="Capítulos do detonado" className="wk-sec">
      <p className="wk-lbl">
        {walkthrough.chapters.map((c) => c.title).join(" · ")}
      </p>
    </nav>
  );
}
