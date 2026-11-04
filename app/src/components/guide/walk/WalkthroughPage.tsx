import type { ReactNode } from "react";
import { BackToTop } from "@/components/guide/BackToTop";
import type { GuideDetail } from "@/lib/queries/games";
import { BackdropFader } from "./BackdropFader";
import { FichaGrid } from "./FichaGrid";
import { GuideHero } from "./GuideHero";
import { PhaseRoadmap } from "./PhaseRoadmap";
import { WalkProgressProvider } from "./progress";
import { ReadFirst } from "./ReadFirst";
import { cleanupChapter } from "./resume";
import { ResumeProvider } from "./resume-state";
import { SoundtrackPlayer } from "./SoundtrackPlayer";
import { SpoilerProvider } from "./spoilers";
import { SteamOnlyList } from "./SteamOnlyList";
import { VersionProvider } from "./version-state";
import { hasVersions } from "./versions";
import { walkView } from "./view";
import { WalkChapters } from "./WalkChapters";
import { JourneyProvider, type JourneyChapter } from "./journey";
import { WalkJourney } from "./WalkJourney";
import { WalkSidebar } from "./WalkSidebar";
import "./walk.css";
import "./walk-chapters.css";

/*
 * Page of a format-2 guide (the guide robot's walkthrough). Top: magazine cover and hero, the
 * ficha, overview, "leia antes" and the roadmap beside the sidebar; then the journey, the chapters
 * along the green line, the Steam-only achievements of a guide written from the PSN list
 * (scope psn), the robot report (staff) and the soundtrack player, over the animated
 * backdrop. Spoilers start off for everyone and are not in the page at all (view.ts).
 *
 * The page is the public guide, the same for everyone (cached). What is per visitor streams into
 * the two slots: `user` (WalkUserIsland: the visitor's ticks and Steam progress) and `report`
 * (WalkReportIsland: the robot report, staff only). From the first, the client computes the
 * signed-in visitor's resume point (resume-state.tsx): the cover's "Continuar de onde parou", the
 * "você está aqui" marker and the lit chapters. "Voltar ao topo" is for everyone.
 *
 * A guide with both lists (versions.tsx) reads as Steam or PlayStation: the page marks what the
 * PlayStation version leaves out, and the visitor's choice picks it on the client (version-state.tsx).
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
  const versions = hasVersions(guide);
  const view = walkView(walkthrough, walk, guide.steps, versions);
  const items = view.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
  const steamOnly = versions ? items.filter((i) => i.steamOnly).map((i) => i.ref) : null;
  const journey: JourneyChapter[] = view.chapters.map((c, i) => {
    const own = c.steps.flatMap((s) => s.items);
    return {
      key: c.key,
      title: c.title,
      phase: c.phase,
      refs: own.map((item) => item.ref),
      steps: c.steps.map((s) => s.items.length),
      missables: own.filter((item) => item.missable).map((item) => ({ ref: item.ref, name: item.name })),
      cleanup: cleanupChapter(c.key, i, view.chapters.length),
      steamOnly: c.steamOnly,
    };
  });
  // Item ref → the Steam achievement it is: an unlocked achievement marks its items as done.
  const achievements = Object.fromEntries(items.flatMap((i) => (i.achievement ? [[i.ref, i.achievement.id]] : [])));

  return (
    <VersionProvider steamOnly={steamOnly}>
      <WalkProgressProvider
        guideId={walk.guideId}
        gameId={guide.game.id}
        returnTo={returnTo}
        preview={preview}
        achievements={achievements}
      >
        <SpoilerProvider guideId={walk.guideId}>
          <JourneyProvider chapters={journey}>
            <ResumeProvider>
              {user}
              <BackdropFader images={walk.screenshots} />
              {preview ? (
                <p className="wk-preview" role="note">
                  Prévia da equipe: este guia ainda não foi publicado. Só admin e editores veem esta página.
                </p>
              ) : null}
              <GuideHero guide={guide} walkthrough={walkthrough} walk={walk} versions={versions} />
              <FichaGrid guide={guide} walkthrough={walkthrough} walk={walk} items={items} />
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
                  <PhaseRoadmap steps={guide.steps} texts={view.roadmap} chapters={view.chapters} />
                </div>
                <WalkSidebar
                  guide={guide}
                  walkthrough={walkthrough}
                  collectibleRefs={items.filter((i) => i.kind === "collectible").map((i) => i.ref)}
                  chapters={view.chapters}
                />
              </div>
              <section id="g-detonado" className="wk-detonado" aria-label="Detonado">
                <WalkJourney />
                <WalkChapters chapters={view.chapters} screenshots={walk.screenshots} />
                <SteamOnlyList achievements={view.steamOnly} />
                {report}
              </section>
              {walkthrough.soundtrack ? <SoundtrackPlayer soundtrack={walkthrough.soundtrack} /> : null}
              <BackToTop />
            </ResumeProvider>
          </JourneyProvider>
        </SpoilerProvider>
      </WalkProgressProvider>
    </VersionProvider>
  );
}
