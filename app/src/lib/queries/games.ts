import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  achievementKey,
  parseStoredBlocks,
  type AchievementCardData,
  type AchievementPlatform,
  type ContentBlock,
} from "@/lib/content/schema";
import { isSafeHttpUrl } from "@/lib/content/url";
import { prisma } from "@/lib/db";
import { rarityTier, xpForAchievement } from "@/lib/engine/xp";
import { SKILLS, type RarityTier, type SkillId } from "@/lib/engine/types";

const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id));

function asSkills(values: string[]): SkillId[] {
  return values.filter((v): v is SkillId => SKILL_IDS.has(v));
}

/** "Almost there": at least 70% unlocked, but not 100%. */
export function isAlmostComplete(unlocked: number, total: number): boolean {
  return total > 0 && unlocked * 100 >= total * 70 && unlocked < total;
}

// ---------- Catalog ----------

export type GameFilter = {
  skill?: SkillId;
  almost?: boolean;
  withGuide?: boolean;
  q?: string;
  /** PLAYSTATION | XBOX | NINTENDO | PC */
  platform?: string;
};

export type GameCard = {
  id: string;
  slug: string;
  name: string;
  coverUrl: string | null;
  platforms: string[];
  skills: SkillId[];
  achievementCount: number;
  /** Null when the visitor is anonymous or does not own the game. */
  unlockedCount: number | null;
  hasGuide: boolean;
};

export async function listGames(filter: GameFilter, userId?: string): Promise<GameCard[]> {
  // "Almost" is relative to someone's progress: no user, no result.
  if (filter.almost && !userId) return [];

  const where: Prisma.GameWhereInput = {};
  if (filter.skill) where.skills = { some: { skill: filter.skill } };
  if (filter.withGuide) where.guide = { is: { status: "published" } };
  if (filter.platform) where.platforms = { has: filter.platform };
  const q = filter.q?.trim();
  if (q) where.name = { contains: q, mode: "insensitive" };

  const games = await prisma.game.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      skills: true,
      guide: { select: { status: true } },
      // Steam progress (achievementCount is the Steam total).
      users: userId ? { where: { userId, platform: "steam" } } : false,
    },
  });

  const cards = games.map<GameCard>((game) => ({
    id: game.id,
    slug: game.slug,
    name: game.name,
    coverUrl: game.coverUrl,
    platforms: game.platforms,
    skills: asSkills(game.skills.map((s) => s.skill)),
    achievementCount: game.achievementCount,
    unlockedCount: game.users?.[0]?.unlockedCount ?? null,
    hasGuide: game.guide?.status === "published",
  }));

  const filtered = filter.almost
    ? cards.filter(
        (c) => c.unlockedCount !== null && isAlmostComplete(c.unlockedCount, c.achievementCount),
      )
    : cards;

  // Games with a full guide first, then alphabetical (the query is already sorted by name).
  return filtered.sort((a, b) => Number(b.hasGuide) - Number(a.hasGuide));
}

export function countGames(): Promise<number> {
  return prisma.game.count();
}

/** Slugs of every game, optionally only those with a published guide (for generateStaticParams). */
export async function listGameSlugs(opts: { withGuide?: boolean } = {}): Promise<string[]> {
  const games = await prisma.game.findMany({
    where: opts.withGuide ? { guide: { is: { status: "published" } } } : {},
    select: { slug: true },
    orderBy: { name: "asc" },
  });
  return games.map((g) => g.slug);
}

// ---------- Game page ----------

export type GuideMeta = {
  version: string;
  updatedAt: Date;
  authorHandle: string | null;
  reviewers: string[];
  stepCount: number;
};

export type GameDetail = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  coverUrl: string | null;
  platforms: string[];
  skills: SkillId[];
  achievementCount: number;
  /** Null when the visitor is anonymous or does not own the game. */
  progress: { unlockedCount: number; playtimeMin: number } | null;
  /** Present only for published guides. */
  guide: GuideMeta | null;
  /** When this object was built; relative dates ("há 3 dias") are measured against it. */
  generatedAt: Date;
};

export async function getGame(slug: string, userId?: string): Promise<GameDetail | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    include: {
      skills: true,
      // Steam progress (achievementCount is the Steam total).
      users: userId ? { where: { userId, platform: "steam" } } : false,
      guide: {
        include: {
          author: { select: { handle: true } },
          revisions: { include: { author: { select: { handle: true } } } },
          _count: { select: { steps: true } },
        },
      },
    },
  });
  if (!game) return null;

  const guide = game.guide?.status === "published" ? game.guide : null;
  const authorHandle = guide?.author?.handle ?? null;
  const reviewers = guide
    ? [
        ...new Set(
          guide.revisions
            .map((r) => r.author?.handle)
            .filter((h): h is string => Boolean(h) && h !== authorHandle),
        ),
      ]
    : [];
  const owned = game.users?.[0];

  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    summary: game.summary,
    coverUrl: game.coverUrl,
    platforms: game.platforms,
    skills: asSkills(game.skills.map((s) => s.skill)),
    achievementCount: game.achievementCount,
    progress: owned ? { unlockedCount: owned.unlockedCount, playtimeMin: owned.playtimeMin } : null,
    generatedAt: new Date(),
    guide: guide
      ? {
          version: guide.version,
          updatedAt: guide.updatedAt,
          authorHandle,
          reviewers,
          stepCount: guide._count.steps,
        }
      : null,
  };
}

/** Lightweight lookup used by generateMetadata. */
export async function getGameTitle(
  slug: string,
): Promise<{ name: string; hasGuide: boolean } | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { name: true, guide: { select: { status: true } } },
  });
  return game ? { name: game.name, hasGuide: game.guide?.status === "published" } : null;
}

// ---------- Guide page ----------

const collectiblesSchema = z.array(
  z.object({ name: z.string(), total: z.number(), description: z.string().default("") }),
);

export type Collectible = z.infer<typeof collectiblesSchema>[number];

export type GuideFacts = {
  difficulty: number;
  hoursMin: number;
  hoursMax: number;
  playthroughs: string;
  missables: number;
  online: number;
};

export type GuideStepView = {
  id: string;
  order: number;
  title: string;
  hours: string;
  /** Plain text (always set): shown when `blocks` is null. */
  body: string;
  /** Rich body (bot guides), validated ContentBlock[]; null for plain-text steps. */
  blocks: ContentBlock[] | null;
  /** Resolved `achievement` blocks of `blocks`. */
  cards: Record<string, AchievementCardData>;
  achievements: { id: string; name: string; tier: RarityTier; done: boolean }[];
  done: boolean;
};

export type GuideAchievementView = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  spoiler: boolean;
  /** Plain text (always set): shown when `tipBlocks` is null. */
  tip: string;
  /** Rich tip (bot guides), validated ContentBlock[]; null for plain-text tips. */
  tipBlocks: ContentBlock[] | null;
  /** Resolved `achievement` blocks of `tipBlocks`. */
  cards: Record<string, AchievementCardData>;
  steps: string[];
  globalPct: number | null;
  tier: RarityTier;
  xp: number;
  done: boolean;
};

export type GuideTipView = {
  id: string;
  body: string;
  votes: number;
  authorHandle: string | null;
  authorLevel: number | null;
  isOwn: boolean;
  voted: boolean;
};

export type GuideSource = { title: string; url: string };

/** Guide.sources is untyped JSON: keeps only `{ title, url }` items with an http(s) URL. */
export function parseGuideSources(value: unknown): GuideSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { title, url } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string" || !title.trim() || !isSafeHttpUrl(url)) return [];
    return [{ title: title.trim(), url }];
  });
}

/** Stored step/tip blocks: null when absent, empty or not a valid ContentBlock[] (plain text is shown). */
function richBlocks(value: unknown): ContentBlock[] | null {
  const blocks = parseStoredBlocks(value);
  return blocks && blocks.length > 0 ? blocks : null;
}

/** Card data for the `achievement` blocks of `blocks`, looked up among the game's achievements. */
function cardsFor(
  blocks: ContentBlock[] | null,
  byKey: Map<string, AchievementCardData>,
): Record<string, AchievementCardData> {
  const out: Record<string, AchievementCardData> = {};
  for (const block of blocks ?? []) {
    if (block.type !== "achievement") continue;
    const key = achievementKey(block.platform, block.apiName);
    const card = byKey.get(key);
    if (card) out[key] = card;
  }
  return out;
}

export type GuideRevisionView = {
  id: string;
  version: string;
  summary: string;
  authorHandle: string | null;
  createdAt: Date;
};

export type GuideDetail = {
  game: GameDetail & { guide: GuideMeta };
  facts: GuideFacts;
  overview: string[];
  warnings: string[];
  collectibles: Collectible[];
  steps: GuideStepView[];
  achievements: GuideAchievementView[];
  tips: GuideTipView[];
  revisions: GuideRevisionView[];
  /** References the guide was written from (bot guides): only http(s) links. */
  sources: GuideSource[];
  totals: { xp: number; pendingCount: number; pendingXp: number };
  /** The game's skills with the visitor's level (null when anonymous). */
  skillLevels: { skill: SkillId; level: number | null }[];
};


/**
 * The guide as every visitor sees it (no per-user marks): safe to cache and to prerender.
 * Null when the game has no published guide.
 */
export async function getGuidePublic(slug: string): Promise<GuideDetail | null> {
  const game = await getGame(slug);
  if (!game || !game.guide) return null;

  const guide = await prisma.guide.findUniqueOrThrow({
    where: { gameId: game.id },
    include: {
      steps: { orderBy: { order: "asc" } },
      notes: { include: { achievement: true } },
      tips: {
        orderBy: [{ votes: "desc" }, { createdAt: "asc" }],
        include: { author: { select: { handle: true, stats: { select: { level: true } } } } },
      },
      revisions: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { handle: true } } },
      },
    },
  });

  // Achievements referenced by steps (by apiName) may include ones without a guide note.
  const stepApiNames = [...new Set(guide.steps.flatMap((s) => s.achievementApiNames))];
  const stepAchievements = stepApiNames.length
    ? await prisma.achievement.findMany({
        // Guide steps name Steam achievements (apiNames repeat across platforms).
        where: { gameId: game.id, platform: "steam", apiName: { in: stepApiNames } },
      })
    : [];
  const byApiName = new Map(stepAchievements.map((a) => [a.apiName, a]));

  // Rich step bodies / tips (bot guides) and the achievements their `achievement` blocks name.
  const stepBlocks = new Map(guide.steps.map((s) => [s.id, richBlocks(s.blocks)]));
  const tipBlocks = new Map(guide.notes.map((n) => [n.id, richBlocks(n.tipBlocks)]));
  const refs = [...stepBlocks.values(), ...tipBlocks.values()].flatMap((blocks) =>
    (blocks ?? []).flatMap((b) => (b.type === "achievement" ? [{ platform: b.platform, apiName: b.apiName }] : [])),
  );
  const referenced = refs.length
    ? await prisma.achievement.findMany({
        where: { gameId: game.id, OR: refs },
        select: { platform: true, apiName: true, name: true, description: true, globalPct: true },
      })
    : [];
  const cardByKey = new Map(
    referenced.map((a) => [
      achievementKey(a.platform as AchievementPlatform, a.apiName),
      { name: a.name, description: a.description, globalPct: a.globalPct, gameName: game.name },
    ]),
  );

  const achievements = guide.notes
    .map<GuideAchievementView>((note) => {
      const a = note.achievement;
      const blocks = tipBlocks.get(note.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        category: note.category,
        spoiler: note.spoiler,
        tip: note.tip,
        tipBlocks: blocks,
        cards: cardsFor(blocks, cardByKey),
        steps: note.steps,
        globalPct: a.globalPct,
        tier: rarityTier(a.globalPct ?? 50),
        xp: xpForAchievement(a.globalPct),
        done: false,
      };
    })
    // Most common (easiest) first, rarest last.
    .sort((a, b) => (b.globalPct ?? 50) - (a.globalPct ?? 50));

  const steps = guide.steps.map<GuideStepView>((step) => ({
    id: step.id,
    order: step.order,
    title: step.title,
    hours: step.hours,
    body: step.body,
    blocks: stepBlocks.get(step.id) ?? null,
    cards: cardsFor(stepBlocks.get(step.id) ?? null, cardByKey),
    achievements: step.achievementApiNames.flatMap((apiName) => {
      const a = byApiName.get(apiName);
      return a ? [{ id: a.id, name: a.name, tier: rarityTier(a.globalPct ?? 50), done: false }] : [];
    }),
    done: false,
  }));

  const totalXp = achievements.reduce((sum, a) => sum + a.xp, 0);

  return {
    game: { ...game, guide: game.guide },
    facts: {
      difficulty: guide.difficulty,
      hoursMin: guide.hoursMin,
      hoursMax: guide.hoursMax,
      playthroughs: guide.playthroughs,
      missables: guide.missables,
      online: guide.online,
    },
    overview: guide.overview,
    warnings: guide.warnings,
    collectibles: parseCollectibles(guide.collectibles),
    steps,
    achievements,
    tips: guide.tips.map((tip) => ({
      id: tip.id,
      body: tip.body,
      votes: tip.votes,
      authorHandle: tip.author?.handle ?? null,
      authorLevel: tip.author?.stats?.level ?? null,
      isOwn: false,
      voted: false,
    })),
    revisions: guide.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      summary: r.summary,
      authorHandle: r.author?.handle ?? null,
      createdAt: r.createdAt,
    })),
    sources: parseGuideSources(guide.sources),
    totals: { xp: totalXp, pendingCount: achievements.length, pendingXp: totalXp },
    skillLevels: game.skills.map((skill) => ({ skill, level: null })),
  };
}

// ---------- Per-user overlay of the guide ----------

/** What a signed-in visitor adds on top of the public guide. */
export type GuideUserState = {
  progress: GameDetail["progress"];
  unlockedAchievementIds: string[];
  doneStepIds: string[];
  votedTipIds: string[];
  ownTipIds: string[];
  skillLevels: Record<string, number>;
};

export async function loadGuideUserState(
  guide: GuideDetail,
  userId: string,
): Promise<GuideUserState> {
  const achievementIds = [
    ...new Set([
      ...guide.achievements.map((a) => a.id),
      ...guide.steps.flatMap((s) => s.achievements.map((a) => a.id)),
    ]),
  ];
  const [owned, unlocks, stepProgress, votes, ownTips, skillRows] = await Promise.all([
    prisma.userGame.findUnique({
      where: { userId_gameId_platform: { userId, gameId: guide.game.id, platform: "steam" } },
    }),
    prisma.userAchievement.findMany({
      where: { userId, achievementId: { in: achievementIds } },
      select: { achievementId: true },
    }),
    prisma.guideStepProgress.findMany({
      where: { userId, stepId: { in: guide.steps.map((s) => s.id) } },
      select: { stepId: true },
    }),
    prisma.guideVote.findMany({
      where: { userId, tipId: { in: guide.tips.map((t) => t.id) } },
      select: { tipId: true },
    }),
    prisma.guideTip.findMany({
      where: { id: { in: guide.tips.map((t) => t.id) }, authorId: userId },
      select: { id: true },
    }),
    prisma.skillProgress.findMany({
      where: { userId, skill: { in: guide.game.skills } },
    }),
  ]);

  return {
    progress: owned ? { unlockedCount: owned.unlockedCount, playtimeMin: owned.playtimeMin } : null,
    unlockedAchievementIds: unlocks.map((u) => u.achievementId),
    doneStepIds: stepProgress.map((s) => s.stepId),
    votedTipIds: votes.map((v) => v.tipId),
    ownTipIds: ownTips.map((t) => t.id),
    skillLevels: Object.fromEntries(skillRows.map((s) => [s.skill, s.level])),
  };
}

/** Pure merge of the public guide with one visitor's progress. */
export function applyGuideUserState(guide: GuideDetail, state: GuideUserState): GuideDetail {
  const unlocked = new Set(state.unlockedAchievementIds);
  const doneSteps = new Set(state.doneStepIds);
  const voted = new Set(state.votedTipIds);
  const own = new Set(state.ownTipIds);

  const achievements = guide.achievements.map((a) => ({ ...a, done: unlocked.has(a.id) }));
  const pending = achievements.filter((a) => !a.done);

  return {
    ...guide,
    game: { ...guide.game, progress: state.progress },
    steps: guide.steps.map((step) => ({
      ...step,
      done: doneSteps.has(step.id),
      achievements: step.achievements.map((a) => ({ ...a, done: unlocked.has(a.id) })),
    })),
    achievements,
    tips: guide.tips.map((tip) => ({
      ...tip,
      voted: voted.has(tip.id),
      isOwn: own.has(tip.id),
    })),
    totals: {
      ...guide.totals,
      pendingCount: pending.length,
      pendingXp: pending.reduce((sum, a) => sum + a.xp, 0),
    },
    skillLevels: guide.skillLevels.map(({ skill }) => ({
      skill,
      level: state.skillLevels[skill] ?? 1,
    })),
  };
}

/** Full guide with the visitor's progress per achievement and step. Null when there is no published guide. */
export async function getGuide(slug: string, userId?: string): Promise<GuideDetail | null> {
  const guide = await getGuidePublic(slug);
  if (!guide || !userId) return guide;
  return applyGuideUserState(guide, await loadGuideUserState(guide, userId));
}

function parseCollectibles(value: unknown): Collectible[] {
  const parsed = collectiblesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
