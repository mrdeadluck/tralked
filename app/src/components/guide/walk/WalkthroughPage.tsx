import type { ReactNode } from "react";
import type { GuideDetail } from "@/lib/queries/games";
import { BackdropFader } from "./BackdropFader";
import { FichaGrid } from "./FichaGrid";
import { GuideHero } from "./GuideHero";
import { PhaseRoadmap } from "./PhaseRoadmap";
import { WalkProgressProvider } from "./progress";
import { ReadFirst } from "./ReadFirst";
import { SoundtrackPlayer } from "./SoundtrackPlayer";
import { SpoilerProvider } from "./spoilers";
import { walkView } from "./view";
import { WalkChapters } from "./WalkChapters";
import { WalkJourney, type JourneyChapter } from "./WalkJourney";
import { WalkSidebar } from "./WalkSidebar";
import "./walk.css";
import "./walk-chapters.css";

/*
 * Page of a format-2 guide (the guide robot's walkthrough). Top: magazine cover and hero, the
 * ficha, overview, "leia antes" and the roadmap beside the sidebar; then the journey, the chapters
 * along the green line, the robot report (staff) and the soundtrack player, over the animated
 * backdrop. Spoilers start off for everyone and are not in the page at all (view.ts).
 *
 * The page is the public guide, the same for everyone (cached). What is per visitor streams into
 * the two slots: `user` (WalkUserIsland: the visitor's ticks and Steam progress) and `report`
 * (WalkReportIsland: the robot report, staff only).
 */

type WalkthroughPageProps = {
  guide: GuideDetail;
  /** The visitor's progress (WalkUserIsland, inside Suspense). */
  user?: ReactNode;
  /** The robot report (WalkReportIsland, inside Suspense). */
  report?: ReactNode;
  /** Staff preview of a guide still in review. */
  preview?: boolean;
};

export function WalkthroughPage({ guide, user = null, report = null, preview = false }: WalkthroughPageProps) {
  const { walkthrough, walk } = guide;
  if (!walkthrough || !walk) return null;
  const returnTo = `/jogos/${guide.game.slug}/guia`;
  const view = walkView(walkthrough, walk, guide.steps);
  const items = view.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
  const journey: JourneyChapter[] = view.chapters.map((c) => {
    const own = c.steps.flatMap((s) => s.items);
    return { key: c.key, title: c.title, phase: c.phase, refs: own.map((i) => i.ref), missables: own.filter((i) => i.missable).length };
  });

  return (
    <div className="wk">
      <WalkProgressProvider guideId={walk.guideId} gameId={guide.game.id} returnTo={returnTo}>
        <SpoilerProvider guideId={walk.guideId}>
          {user}
          <BackdropFader images={walk.screenshots} />
          {preview ? (
            <p className="wk-preview" role="note">
              Prévia da equipe: este guia ainda não foi publicado. Só admin e editores veem esta página.
            </p>
          ) : null}
          <GuideHero guide={guide} walkthrough={walkthrough} walk={walk} />
          <FichaGrid guide={guide} walkthrough={walkthrough} walk={walk} />
          <div className="wk-intro">
            <div className="wk-vg">
              {guide.overview.length > 0 ? (
                <section id="g-visao" className="scroll-mt-24" aria-labelledby="g-visao-h">
                  <h2 id="g-visao-h" className="wk-h3">
                    Visão geral
                  </h2>
                  {guide.overview.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ) : null}
              <ReadFirst notes={view.notes} missables={view.missables} />
              <PhaseRoadmap steps={guide.steps} texts={view.roadmap} walkthrough={walkthrough} />
            </div>
            <WalkSidebar
              guide={guide}
              walkthrough={walkthrough}
              collectibleRefs={items.filter((i) => i.kind === "collectible").map((i) => i.ref)}
            />
          </div>
          <section id="g-detonado" className="wk-detonado" aria-label="Detonado">
            <WalkJourney chapters={journey} />
            <WalkChapters chapters={view.chapters} screenshots={walk.screenshots} />
            {report}
          </section>
          {walkthrough.soundtrack ? <SoundtrackPlayer soundtrack={walkthrough.soundtrack} /> : null}
        </SpoilerProvider>
      </WalkProgressProvider>
    </div>
  );
}
