import type { GuideDetail } from "@/lib/queries/games";
import { FichaGrid } from "./FichaGrid";
import { GuideHero } from "./GuideHero";
import { PhaseRoadmap } from "./PhaseRoadmap";
import { ReadFirst } from "./ReadFirst";
import { SpoilerProvider } from "./spoilers";
import { WalkChapters } from "./WalkChapters";
import { WalkJourney } from "./WalkJourney";
import { WalkSidebar } from "./WalkSidebar";
import "./walk.css";

/*
 * Page of a format-2 guide (the guide robot's walkthrough). Top: magazine cover and hero, the
 * ficha, overview, "leia antes" and the roadmap beside the sidebar; then the journey and the
 * chapters. Spoilers start off for everyone.
 */

/** Who is reading: null for an anonymous visitor. `staff` (admin, editor) sees the robot report. */
export type WalkViewer = { id: string; handle: string; staff: boolean } | null;

type WalkthroughPageProps = { guide: GuideDetail; viewer: WalkViewer };

export function WalkthroughPage({ guide, viewer }: WalkthroughPageProps) {
  const { walkthrough, walk } = guide;
  if (!walkthrough || !walk) return null;
  const returnTo = `/jogos/${guide.game.slug}/guia`;

  return (
    <div className="wk">
      <SpoilerProvider>
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
            <ReadFirst walkthrough={walkthrough} walk={walk} />
            <PhaseRoadmap steps={guide.steps} walkthrough={walkthrough} />
          </div>
          <WalkSidebar guide={guide} walkthrough={walkthrough} loggedIn={viewer !== null} returnTo={returnTo} />
        </div>
        <WalkJourney walkthrough={walkthrough} />
        <WalkChapters walkthrough={walkthrough} />
      </SpoilerProvider>
    </div>
  );
}
