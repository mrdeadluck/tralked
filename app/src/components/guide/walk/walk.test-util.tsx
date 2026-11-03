import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import example from "@/lib/api/example-walkthrough.json";
import { walkthroughSchema } from "@/lib/content/walkthrough-schema";
import type { GuideDetail, WalkAchievementView } from "@/lib/queries/games";
import { CoverArt } from "@/components/art/CoverArt";
import { Toc } from "@/components/guide/Toc";
import { BackdropFader } from "./BackdropFader";
import { ChapterTimeline } from "./ChapterTimeline";
import { GreenTrail } from "./GreenTrail";
import { JourneyProvider } from "./journey";
import { WalkProgressProvider, WalkUserSeed } from "./progress";
import { DoneCount, ProgressCard, ProgressRing } from "./ProgressBits";
import { SoundtrackPlayer } from "./SoundtrackPlayer";
import {
  SpoilerAchievement,
  SpoilerCallout,
  SpoilerGate,
  SpoilerItemName,
  SpoilerNote,
  SpoilerProvider,
  SpoilerSpan,
} from "./spoilers";
import { SpoilerToggle } from "./SpoilerToggle";
import { WalkItemRow } from "./WalkItemRow";
import { WalkJourney } from "./WalkJourney";

/*
 * Test helpers (not a test): the Phantom Blade Zero guide as getGuidePublic returns it, and what a
 * server render of the walkthrough page sends to the browser, to prove spoilers stay out of it.
 */

/** The example walkthrough (Phantom Blade Zero, region 1) the API documents. */
export const walkthrough = walkthroughSchema.parse(example);

export function ach(apiName: string, name: string | null, globalPct: number, hidden = false): WalkAchievementView {
  return { id: `id-${apiName}`, apiName, name, description: null, iconUrl: null, globalPct, hidden, xp: 50, done: false };
}

const hardest = ach("ACH_TRUE_ENDING", "Sangue e Coração", 4.7);

/** The Phantom Blade Zero guide as getGuidePublic returns it (format 2, edition 1). */
export function pbzGuide(over: Partial<GuideDetail> = {}): GuideDetail {
  const now = new Date("2026-11-03T12:00:00Z");
  return {
    game: {
      id: "game-pbz",
      slug: "phantom-blade-zero",
      name: "Phantom Blade Zero",
      summary: null,
      coverUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/library_600x900.jpg",
      platforms: ["PC", "PLAYSTATION"],
      skills: [],
      achievementCount: 66,
      heroUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/library_hero.jpg",
      timeToBeatCompleteMin: null,
      progress: null,
      generatedAt: now,
      guide: {
        version: null,
        updatedAt: now,
        dateKind: "published",
        authorHandle: null,
        reviewers: [],
        stepCount: 1,
        human: false,
      },
    },
    format: 2,
    walkthrough,
    edition: 1,
    compat: "steam_only",
    report: null,
    walk: {
      guideId: "guide-pbz",
      steamAppId: 4115450,
      logoUrl: null,
      hours: { min: 30, max: 40 },
      hiddenCount: 36,
      achievements: {
        ACH_TRUE_ENDING: hardest,
        ACH_HEALER_LEGACY: ach("ACH_HEALER_LEGACY", "Legado da Curandeira", 13.9),
        ACH_SCARLET_SPECTRAL_BLADE: ach("ACH_SCARLET_SPECTRAL_BLADE", null, 67.1, true),
      },
      hardest,
      compatCounts: { steam: 66, psn: 36 },
      screenshots: [],
    },
    itemsDone: new Set(),
    facts: { difficulty: 5, timeTo100: null, playthroughs: "1", missables: 7, online: 0 },
    overview: ["Phantom Blade Zero é um soulslike de ação com nove regiões ligadas."],
    warnings: [],
    collectibles: [],
    steps: [
      {
        id: "s1",
        key: "ate-mirage-estate",
        order: 0,
        title: "Até a Mirage Estate",
        hours: "4 a 6 h",
        body: "Weeping Creek Valley e a Crimson Forest, com os coletáveis de cada região.",
        blocks: null,
        cards: {},
        achievements: [],
        done: false,
      },
    ],
    achievements: [],
    tips: [],
    revisions: [],
    sources: [{ title: "PowerPyx", url: "https://www.powerpyx.com/" }],
    totals: { xp: 150, pendingCount: 3, pendingXp: 150 },
    skillLevels: [],
    ...over,
  };
}

/** Client components of the walkthrough page: their props are what React serializes to the browser. */
export const CLIENT = new Set<unknown>([
  SpoilerProvider,
  SpoilerGate,
  SpoilerAchievement,
  SpoilerNote,
  SpoilerItemName,
  SpoilerCallout,
  SpoilerSpan,
  SpoilerToggle,
  WalkProgressProvider,
  WalkUserSeed,
  ProgressRing,
  ProgressCard,
  DoneCount,
  WalkJourney,
  JourneyProvider,
  ChapterTimeline,
  WalkItemRow,
  GreenTrail,
  BackdropFader,
  SoundtrackPlayer,
  Toc,
  CoverArt,
  Link,
]);

/**
 * Every rendered string, plus the props (minus children) and the React key of each client
 * component. Server components are expanded by calling them.
 */
export function shipped(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((child) => shipped(child, out));
  else if (typeof node === "string" || typeof node === "number") out.push(String(node));
  else if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    if (el.key) out.push(el.key);
    if (typeof el.type === "function" && !CLIENT.has(el.type)) {
      shipped((el.type as (props: unknown) => ReactNode)(el.props), out);
      return out;
    }
    const { children, ...props } = el.props;
    if (CLIENT.has(el.type)) out.push(JSON.stringify(props));
    else for (const value of Object.values(props)) if (typeof value === "string") out.push(value);
    shipped(children, out);
  }
  return out;
}
