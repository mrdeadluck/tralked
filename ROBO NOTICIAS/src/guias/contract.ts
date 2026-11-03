import type { ContentBlock, GameRef } from "../tralked.js";

/**
 * Guide format 2 as the robot builds it. Hand-mirrored from the site's zod schema
 * (app/src/lib/content/walkthrough-schema.ts); test/guias/contract.test.ts validates a fixture
 * against the real schema and checks that GuidePayloadV2 is assignable to the site's input type,
 * so a drift on either side fails a test.
 */

export const WALK_ITEM_KINDS = ["collectible", "achievement", "mission", "key_item", "boss", "other"] as const;
export const GUIDE_COMPAT = ["steam_only", "psn_xbox", "psn", "xbox"] as const;

export type WalkItemKind = (typeof WALK_ITEM_KINDS)[number];
export type GuideCompat = (typeof GUIDE_COMPAT)[number];

export type WalkSource = { name: string; url: string };

export type WalkItem = {
  key: string;
  kind: WalkItemKind;
  name: string;
  nameEn?: string;
  collectibleType?: string;
  index?: number;
  total?: number;
  location?: string;
  missable: boolean;
  returnLater: boolean;
  spoiler: boolean;
  /** Steam apiName of the achievement this item is. */
  achievement?: string;
  /** Steam apiNames this item counts toward. */
  countsFor: string[];
  alsoOn: ("psn" | "xbox")[];
  image?: { url: string; credit: string; sourceName: string; sourceUrl?: string };
  sources: WalkSource[];
  review: boolean;
};

export type WalkStep = { key: string; body: ContentBlock[]; items: WalkItem[] };

export type WalkChapter = {
  key: string;
  /** Key of the roadmap step (payload `steps[]`) the chapter belongs to. */
  phaseKey: string;
  title: string;
  region?: string;
  hours: string;
  sceneImage?: string;
  deadline?: string;
  steps: WalkStep[];
};

export type Walkthrough = {
  cover: {
    /** Exactly 3. */
    calls: { value: string; label: string }[];
    sealHours: string;
    headline: string;
    deck: string;
  };
  extraFacts: {
    buggedCount: number;
    hardest: { apiName: string } | null;
    playthroughsNote: string;
    difficultyNote: string;
  };
  compat: GuideCompat;
  readFirst: { title: string; text: string; tone: "aviso" | "info"; spoiler: boolean }[];
  chapters: WalkChapter[];
  soundtrack?: { youtubeId?: string; playlistId?: string; title: string; channel: string };
};

/** Body of `POST /api/v1/guides` with `format: 2` (the robot never sends `status: "published"`). */
export type GuidePayloadV2 = {
  game: GameRef;
  format: 2;
  walkthrough: Walkthrough;
  status?: "review";
  version?: string;
  facts: {
    difficulty: number;
    hoursMin: number;
    hoursMax: number;
    playthroughs: string;
    missables: number;
    online: number;
  };
  overview?: string[];
  warnings?: string[];
  body?: ContentBlock[];
  /** The roadmap: each step carries a key that chapters point at with phaseKey. */
  steps: { key?: string; title: string; hours: string; body: ContentBlock[]; achievements?: string[] }[];
  achievementNotes?: {
    apiName: string;
    platform?: "steam" | "psn" | "xbox" | "retro";
    category: "historia" | "chefes" | "coletaveis" | "desafio" | "dlc";
    spoiler?: boolean;
    tip: ContentBlock[];
    steps?: string[];
  }[];
  collectibles?: { name: string; total: number; description?: string }[];
  sources?: { title: string; url: string }[];
};
