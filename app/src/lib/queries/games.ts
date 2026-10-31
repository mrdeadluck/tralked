import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
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
      users: userId ? { where: { userId } } : false,
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
};

export async function getGame(slug: string, userId?: string): Promise<GameDetail | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    include: {
      skills: true,
      users: userId ? { where: { userId } } : false,
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
  body: string;
  achievements: { name: string; tier: RarityTier; done: boolean }[];
  done: boolean;
};

export type GuideAchievementView = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  spoiler: boolean;
  tip: string;
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
  totals: { xp: number; pendingCount: number; pendingXp: number };
  /** The game's skills with the visitor's level (null when anonymous). */
  skillLevels: { skill: SkillId; level: number | null }[];
};

/** Full guide with the visitor's progress per achievement and step. Null when there is no published guide. */
export async function getGuide(slug: string, userId?: string): Promise<GuideDetail | null> {
  const game = await getGame(slug, userId);
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
        where: { gameId: game.id, apiName: { in: stepApiNames } },
      })
    : [];

  const noteAchievementIds = guide.notes.map((n) => n.achievementId);
  const [unlocks, stepProgress, votes, skillRows] = userId
    ? await Promise.all([
        prisma.userAchievement.findMany({
          where: {
            userId,
            achievementId: { in: [...noteAchievementIds, ...stepAchievements.map((a) => a.id)] },
          },
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
        prisma.skillProgress.findMany({ where: { userId, skill: { in: game.skills } } }),
      ])
    : [[], [], [], []];

  const unlocked = new Set(unlocks.map((u) => u.achievementId));
  const doneSteps = new Set(stepProgress.map((s) => s.stepId));
  const votedTips = new Set(votes.map((v) => v.tipId));
  const skillLevel = new Map(skillRows.map((s) => [s.skill, s.level]));
  const byApiName = new Map(stepAchievements.map((a) => [a.apiName, a]));

  const achievements = guide.notes
    .map<GuideAchievementView>((note) => {
      const a = note.achievement;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        category: note.category,
        spoiler: note.spoiler,
        tip: note.tip,
        steps: note.steps,
        globalPct: a.globalPct,
        tier: rarityTier(a.globalPct ?? 50),
        xp: xpForAchievement(a.globalPct),
        done: unlocked.has(a.id),
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
    achievements: step.achievementApiNames.flatMap((apiName) => {
      const a = byApiName.get(apiName);
      return a
        ? [{ name: a.name, tier: rarityTier(a.globalPct ?? 50), done: unlocked.has(a.id) }]
        : [];
    }),
    done: doneSteps.has(step.id),
  }));

  const pending = achievements.filter((a) => !a.done);

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
      isOwn: Boolean(userId) && tip.authorId === userId,
      voted: votedTips.has(tip.id),
    })),
    revisions: guide.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      summary: r.summary,
      authorHandle: r.author?.handle ?? null,
      createdAt: r.createdAt,
    })),
    totals: {
      xp: achievements.reduce((sum, a) => sum + a.xp, 0),
      pendingCount: pending.length,
      pendingXp: pending.reduce((sum, a) => sum + a.xp, 0),
    },
    skillLevels: game.skills.map((skill) => ({
      skill,
      level: userId ? (skillLevel.get(skill) ?? 1) : null,
    })),
  };
}

function parseCollectibles(value: unknown): Collectible[] {
  const parsed = collectiblesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
