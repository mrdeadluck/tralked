import { prisma } from "@/lib/db";
import { rankStatsWrites } from "@/lib/highscores/write";
import { ATTRIBUTES, computeAttributes, type AttributeInput } from "@/lib/engine/attributes";
import {
  generateMissions,
  missionProgress,
  type MissionCondition,
  type UnlockEvent,
} from "@/lib/engine/missions";
import { computeStreak, toLocalDay } from "@/lib/engine/streak";
import { trophyTierFromRarity, type TrophyTier } from "@/lib/engine/trophies";
import { SKILLS, type SkillId, type SkillState } from "@/lib/engine/types";
import { vocationFor } from "@/lib/engine/vocation";
import { playtimeGameId } from "@/lib/engine/playtime";
import { levelFromXp } from "@/lib/engine/xp";
import { notifyLevelUp, notifyMissionDone } from "@/lib/notifications/progress";
import { dailyPeriodKey, isoWeekKey, weeklyPeriodKey } from "./periods";
import { skillPointTotals, skillsFromLedger, type LedgerSkillEntry } from "./skills-from-ledger";
import { countedUnlocks } from "@/lib/trophies/counted";
import { isListPlatform, LIST_PLATFORMS, platinumGameId, platinumSourceKey, refreshGameCompletion, settleListXp } from "./list-xp";

const DAY_MS = 86_400_000;
// Longest period start we may need (the Monday of the current ISO week) is under 7 days back.
const EVENT_LOOKBACK_DAYS = 8;
const TOP_SKILL_COUNT = 3;
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

type SkillMap = Record<SkillId, SkillState>;

// The `platinum` keys moved with the version rule (list-xp.ts); re-exported for existing imports.
export { platinumGameId, platinumSourceKey };

/**
 * Current skills of the games behind `achievement` (sourceKey = achievementId), `platinum`
 * (see `platinumGameId`) and `playtime` (see `playtimeGameId`) ledger entries, keyed by
 * `${source}:${sourceKey}`.
 */
async function currentGameSkills(
  rows: { source: string; sourceKey: string }[],
): Promise<Map<string, string[]>> {
  const keysOf = (source: string) => rows.filter((r) => r.source === source).map((r) => r.sourceKey);
  const achievementIds = keysOf("achievement");
  const platinumKeys = keysOf("platinum");
  const platinumGameIds = platinumKeys.map(platinumGameId);
  const playtimeKeys = keysOf("playtime");
  const playtimeGameIds = playtimeKeys.map(playtimeGameId);
  if (achievementIds.length === 0 && platinumGameIds.length === 0 && playtimeGameIds.length === 0) {
    return new Map();
  }

  const achievements = achievementIds.length
    ? await prisma.achievement.findMany({
        where: { id: { in: achievementIds } },
        select: { id: true, gameId: true },
      })
    : [];
  const games = await prisma.game.findMany({
    where: {
      id: { in: [...new Set([...platinumGameIds, ...playtimeGameIds, ...achievements.map((a) => a.gameId)])] },
    },
    select: { id: true, skills: { select: { skill: true } } },
  });
  const skillsByGame = new Map(games.map((g) => [g.id, g.skills.map((s) => s.skill)]));

  // Entries whose achievement or game no longer exists are left out (they keep their copy).
  const result = new Map<string, string[]>();
  for (const a of achievements) {
    const skills = skillsByGame.get(a.gameId);
    if (skills) result.set(`achievement:${a.id}`, skills);
  }
  for (const key of platinumKeys) {
    const skills = skillsByGame.get(platinumGameId(key));
    if (skills) result.set(`platinum:${key}`, skills);
  }
  for (const key of playtimeKeys) {
    const skills = skillsByGame.get(playtimeGameId(key));
    if (skills) result.set(`playtime:${key}`, skills);
  }
  return result;
}

/**
 * Loads the ledger for the skill rebuild. XP is frozen at record time, but the genre mapping is
 * not: `achievement`, `platinum` and `playtime` entries without explicit `skillPoints` take the skills their
 * game has now (so a game that only later got skills, from the catalog job or an admin override,
 * also counts for past unlocks). Entries with explicit `skillPoints` (seed, photo_approved, forum_solved) and
 * sources without a game keep their own `skills`. The `skills` column stays as an audit copy.
 * Voided entries (confirmed fraud) are left out.
 */
async function loadLedger(userId: string) {
  const rows = await prisma.xpLedgerEntry.findMany({
    where: { userId, voidedAt: null },
    select: { source: true, sourceKey: true, xp: true, skills: true, skillPoints: true },
  });
  const fromGame = await currentGameSkills(rows.filter((r) => r.skillPoints === null));
  const entries: LedgerSkillEntry[] = rows.map((r) => {
    const skillPoints = r.skillPoints as Record<string, number> | null;
    return {
      xp: r.xp,
      skills: fromGame.get(`${r.source}:${r.sourceKey}`) ?? r.skills,
      skillPoints,
    };
  });
  return { entries, totalXp: rows.reduce((sum, r) => sum + r.xp, 0) };
}

/** The most trained skills (sabio excluded: missions can't target it). */
function topSkillsOf(skills: SkillMap): SkillId[] {
  return SKILLS.filter((s) => s.id !== "sabio")
    .map((s) => ({ id: s.id, ...skills[s.id] }))
    .filter((s) => s.level > 1 || s.points > 0)
    .sort((a, b) => b.level - a.level || b.points - a.points)
    .slice(0, TOP_SKILL_COUNT)
    .map((s) => s.id);
}

async function loadUnlockEvents(userId: string, from: Date, to?: Date) {
  const select = {
    unlockedAt: true,
    suspicious: true,
    achievementId: true,
    achievement: {
      select: {
        gameId: true,
        platform: true,
        apiName: true,
        globalPct: true,
        list: { select: { platform: true, console: true, externalId: true } },
        game: { select: { skills: { select: { skill: true } } } },
      },
    },
  } as const;
  const inWindow = await prisma.userAchievement.findMany({
    where: { userId, unlockedAt: { gte: from, ...(to && { lte: to }) } },
    select,
  });
  // Once per console: a PSN trophy first earned in another regional list before the window is no
  // new event, so the earlier copies of the window's PSN trophies are looked up too.
  const psn = inWindow.filter((r) => r.achievement.platform === "psn" && !r.suspicious);
  const earlier = psn.length
    ? await prisma.userAchievement.findMany({
        where: {
          userId,
          suspicious: false,
          unlockedAt: { lt: from },
          achievement: {
            platform: "psn",
            gameId: { in: [...new Set(psn.map((r) => r.achievement.gameId))] },
            apiName: { in: [...new Set(psn.map((r) => r.achievement.apiName))] },
          },
        },
        select,
      })
    : [];
  // Suspicious unlocks stay events (they carry the flag); only clean copies dedupe each other.
  const counted = new Set([
    ...countedUnlocks([...inWindow, ...earlier].filter((r) => !r.suspicious)),
    ...inWindow.filter((r) => r.suspicious),
  ]);
  return inWindow
    .filter((r) => counted.has(r))
    .map(
      (r): UnlockEvent => ({
        achievementId: r.achievementId,
        gameId: r.achievement.gameId,
        globalPct: r.achievement.globalPct,
        skills: r.achievement.game.skills.map((s) => s.skill as SkillId),
        unlockedAt: r.unlockedAt,
        suspicious: r.suspicious,
      }),
    );
}

/**
 * Creates the missions of the current day and ISO week (3 daily + 2 weekly), updates their progress from
 * the period's non-suspicious unlocks and pays each completed mission exactly once.
 * Returns whether any mission was completed by this call.
 */
async function applyMissions(userId: string, now: Date, topSkills: SkillId[]): Promise<boolean> {
  const weekKey = weeklyPeriodKey(now);
  const periods = [
    {
      kind: "daily" as const,
      periodKey: dailyPeriodKey(now),
      inPeriod: (day: string) => day === dailyPeriodKey(now),
    },
    {
      kind: "weekly" as const,
      periodKey: weekKey,
      inPeriod: (day: string) => isoWeekKey(day) === weekKey,
    },
  ];
  const events = await loadUnlockEvents(userId, new Date(now.getTime() - EVENT_LOOKBACK_DAYS * DAY_MS));
  let completedAny = false;

  for (const { kind, periodKey, inPeriod } of periods) {
    let missions = await prisma.mission.findMany({ where: { userId, kind, periodKey } });
    // Top up to the full set (3 daily / 2 weekly); existing missions are never replaced.
    const wanted = generateMissions(`${userId}:${periodKey}`, kind, topSkills);
    const have = new Set(missions.map((m) => m.title));
    const missing = wanted
      .filter((m) => !have.has(m.title))
      .slice(0, Math.max(0, wanted.length - missions.length));
    if (missing.length > 0) {
      await prisma.mission.createMany({
        data: missing.map((m) => ({
          userId,
          kind,
          periodKey,
          title: m.title,
          condition: m.condition,
          rewardXp: m.rewardXp,
        })),
        skipDuplicates: true,
      });
      missions = await prisma.mission.findMany({ where: { userId, kind, periodKey } });
    }

    const periodEvents = events.filter((e) => inPeriod(toLocalDay(e.unlockedAt)));
    for (const mission of missions) {
      if (mission.completedAt) continue;
      const condition = mission.condition as MissionCondition;
      const { count, done } = missionProgress(condition, periodEvents);
      const progress = Math.min(count, condition.minCount);

      if (!done) {
        if (progress !== mission.progress) {
          await prisma.mission.update({ where: { id: mission.id }, data: { progress } });
        }
        continue;
      }
      // The guarded update makes completion happen once even if two recomputes race;
      // the ledger's unique (userId, source, sourceKey) is a second guard on the payment.
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.mission.updateMany({
          where: { id: mission.id, completedAt: null },
          data: { progress, completedAt: now },
        });
        if (claimed.count === 0) return;
        await tx.xpLedgerEntry.createMany({
          data: [
            {
              userId,
              source: "mission",
              sourceKey: mission.id,
              xp: mission.rewardXp,
              skills: [],
            },
          ],
          skipDuplicates: true,
        });
        // Return trigger: the bell says so even when the mission completed in a background sync.
        await notifyMissionDone(tx, userId, mission, now);
        completedAny = true;
      });
    }
  }
  return completedAny;
}

/** Valid (non-suspicious) unlocks of every platform, with what the attributes need. */
function loadValidUnlocks(userId: string) {
  return prisma.userAchievement.findMany({
    where: { userId, suspicious: false },
    select: {
      unlockedAt: true,
      hardcore: true,
      achievement: {
        select: {
          gameId: true,
          platform: true,
          apiName: true,
          globalPct: true,
          trophyTier: true,
          list: { select: { platform: true, console: true, externalId: true } },
        },
      },
    },
  });
}

type ValidUnlock = Awaited<ReturnType<typeof loadValidUnlocks>>[number];

const TROPHY_TIERS = new Set<string>(["bronze", "silver", "gold", "platinum"]);

/** Native tier (PSN) when there is one, otherwise the tier from the global rarity. */
const tierOf = (a: ValidUnlock["achievement"]): TrophyTier =>
  a.trophyTier && TROPHY_TIERS.has(a.trophyTier)
    ? (a.trophyTier as TrophyTier)
    : trophyTierFromRarity(a.globalPct);

/**
 * Builds the attribute input from the database. Games are merged across platforms (one game
 * owned on Steam and PSN is one game): playtime adds up, unlocks are pooled, and the game is
 * complete when any platform is. A platform completion with a suspicious unlock (anti-fraud or
 * voided by an admin) does not count. A valid completion on a platform without native platinum
 * trophies (Steam, Xbox, RetroAchievements) counts as one platinum for Glória. Genres only come from
 * games actually played (playtime or at least one unlock).
 */
async function attributeInput(
  userId: string,
  unlocks: ValidUnlock[],
  streak: { activeDays: number; bestStreak: number },
  sabioPoints: number,
): Promise<AttributeInput> {
  const [userGames, tainted, solvedAnswers, publishedGuides] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId },
      select: { gameId: true, platform: true, playtimeMin: true, completedAt: true },
    }),
    // A completion with any suspicious (or fraud-voided) unlock is no completion.
    prisma.userAchievement.findMany({
      where: { userId, suspicious: true },
      select: { achievement: { select: { gameId: true, platform: true } } },
    }),
    prisma.forumThread.count({
      where: {
        solvedPost: { is: { authorId: userId, status: "visible" } },
        // Solving one's own question does not count.
        OR: [{ authorId: null }, { authorId: { not: userId } }],
      },
    }),
    prisma.guide.count({ where: { authorId: userId, status: "published" } }),
  ]);

  type GameAcc = { playtimeMin: number; unlocked: AttributeInput["games"][number]["unlocked"]; completed: boolean };
  const games = new Map<string, GameAcc>();
  const accOf = (gameId: string) => {
    let acc = games.get(gameId);
    if (!acc) {
      acc = { playtimeMin: 0, unlocked: [], completed: false };
      games.set(gameId, acc);
    }
    return acc;
  };

  const nativePlatinum = new Set<string>();
  for (const u of unlocks) {
    const tier = tierOf(u.achievement);
    if (tier === "platinum") nativePlatinum.add(`${u.achievement.gameId}:${u.achievement.platform}`);
    accOf(u.achievement.gameId).unlocked.push({
      globalPct: u.achievement.globalPct,
      hardcore: u.hardcore,
      tier,
    });
  }
  const taintedKeys = new Set(tainted.map((t) => `${t.achievement.gameId}:${t.achievement.platform}`));
  for (const ug of userGames) {
    const acc = accOf(ug.gameId);
    acc.playtimeMin += Math.max(0, ug.playtimeMin);
    const key = `${ug.gameId}:${ug.platform}`;
    if (ug.completedAt && !taintedKeys.has(key)) {
      acc.completed = true;
      // PSN has native platinum trophies: a PSN completion never gets a synthetic one.
      if (ug.platform !== "psn" && !nativePlatinum.has(key)) {
        acc.unlocked.push({ globalPct: null, hardcore: false, tier: "platinum" });
      }
    }
  }

  const played = [...games].filter(([, g]) => g.playtimeMin > 0 || g.unlocked.length > 0);
  const skillRows = await prisma.gameSkill.findMany({
    where: { gameId: { in: played.map(([id]) => id) } },
    select: { gameId: true, skill: true },
  });
  const skillsByGame = new Map<string, SkillId[]>();
  for (const row of skillRows) {
    skillsByGame.set(row.gameId, [...(skillsByGame.get(row.gameId) ?? []), row.skill as SkillId]);
  }

  return {
    games: [...games].map(([gameId, g]) => ({ ...g, skills: skillsByGame.get(gameId) ?? [] })),
    activeDays: streak.activeDays,
    bestStreak: streak.bestStreak,
    sabioPoints,
    solvedAnswers,
    publishedGuides,
  };
}

/**
 * Rebuilds everything derived from the XP ledger and the unlocks for one user: missions
 * (create, progress, payment), SkillProgress, AttributeProgress, total XP, level, vocation,
 * streak and the highscores totals (UserRankStats). Voided ledger entries and suspicious unlocks are left out. Safe to run any number of
 * times, also concurrently: the ledger is only ever appended to with unique keys.
 */
export async function recomputeUser(userId: string, now: Date = new Date()): Promise<void> {
  let { entries, totalXp } = await loadLedger(userId);
  let skills = skillsFromLedger(entries);

  if (await applyMissions(userId, now, topSkillsOf(skills))) {
    ({ entries, totalXp } = await loadLedger(userId));
    skills = skillsFromLedger(entries);
  }

  // Once per console: the same PSN trophy in two regional lists counts one time everywhere below.
  const unlocks = countedUnlocks(await loadValidUnlocks(userId));
  const days = [...new Set(unlocks.map((u) => toLocalDay(u.unlockedAt)))];
  const streak = computeStreak(days, toLocalDay(now));
  const attributes = computeAttributes(
    await attributeInput(
      userId,
      unlocks,
      { activeDays: days.length, bestStreak: streak.best },
      skillPointTotals(entries).sabio,
    ),
  );
  const stats = {
    totalXp,
    level: levelFromXp(totalXp).level,
    vocation: vocationFor(skills),
    streakCurrent: streak.current,
    streakBest: streak.best,
    shields: streak.shields,
  };
  const rankStats = await rankStatsWrites(userId, unlocks);
  // Level before this rebuild: a rise becomes a `level_up` notification. No row yet means the
  // first import, which the "Despertar" sequence celebrates instead.
  const previous = await prisma.userStats.findUnique({ where: { userId }, select: { level: true } });

  await prisma.$transaction([
    ...rankStats,
    ...SKILLS.map(({ id }) =>
      prisma.skillProgress.upsert({
        where: { userId_skill: { userId, skill: id } },
        create: { userId, skill: id, ...skills[id] },
        update: skills[id],
      }),
    ),
    ...ATTRIBUTES.map(({ id }) =>
      prisma.attributeProgress.upsert({
        where: { userId_attribute: { userId, attribute: id } },
        create: { userId, attribute: id, ...attributes[id] },
        update: attributes[id],
      }),
    ),
    prisma.userStats.upsert({
      where: { userId },
      create: { userId, ...stats },
      update: stats,
    }),
  ]);
  if (previous && stats.level > previous.level) {
    await notifyLevelUp(prisma, userId, previous.level, stats.level, now);
  }
}

/**
 * Re-checks the completed missions of the periods (days and ISO weeks) that contain `days`
 * against the non-suspicious unlocks of those periods. A mission that is no longer complete gets
 * its reward voided, its completion cleared and its progress lowered. Returns how many mission
 * rewards were voided. Known limit: if later valid unlocks complete it again in the same period,
 * the reward is not paid a second time (the voided entry keeps its unique key). Used by confirmed
 * fraud (`voidFraudEntries`) and by unlinking a platform (`unlink` in accounts/link.ts).
 */
export async function revalidateMissions(userId: string, days: string[], now: Date): Promise<number> {
  if (days.length === 0) return 0;
  const weeks = [...new Set(days.map(isoWeekKey))];
  const missions = await prisma.mission.findMany({
    where: {
      userId,
      completedAt: { not: null },
      OR: [
        { kind: "daily", periodKey: { in: days } },
        { kind: "weekly", periodKey: { in: weeks } },
      ],
    },
  });
  if (missions.length === 0) return 0;

  // Every unlock of the affected weeks (a week spans at most 7 days around any of `days`).
  const sorted = [...days].sort();
  const from = new Date(new Date(`${sorted[0]}T00:00:00Z`).getTime() - 8 * DAY_MS);
  const to = new Date(new Date(`${sorted.at(-1)}T00:00:00Z`).getTime() + 9 * DAY_MS);
  const events = await loadUnlockEvents(userId, from, to);

  let voided = 0;
  for (const mission of missions) {
    const inPeriod = (day: string) =>
      mission.kind === "daily" ? day === mission.periodKey : isoWeekKey(day) === mission.periodKey;
    const condition = mission.condition as MissionCondition;
    const { count, done } = missionProgress(
      condition,
      events.filter((e) => inPeriod(toLocalDay(e.unlockedAt))),
    );
    if (done) continue;
    await prisma.$transaction([
      prisma.mission.update({
        where: { id: mission.id },
        data: { completedAt: null, progress: Math.min(count, condition.minCount) },
      }),
      prisma.xpLedgerEntry.updateMany({
        where: { userId, source: "mission", sourceKey: mission.id, voidedAt: null },
        data: { voidedAt: now },
      }),
    ]);
    voided++;
  }
  return voided;
}

/**
 * Confirmed fraud: marks the unlocks suspicious (so no later sync pays them again) and clears the
 * completion they taint (no Coleção/Glória for a tainted 100%), voids the ledger entries that
 * depended on them, voids the rewards of missions that are no longer complete without them, then
 * recomputes. Entries are never deleted, so the decision stays auditable. Returns how many ledger
 * entries were voided.
 * - Steam: the entries of these achievements and the platinum bonus of every game they belong to.
 * - PSN/Xbox/RA: the completion of the lists holding them is cleared (the game's becomes the
 *   earliest clean list's, or none), then settleListXp reconciles the affected games: what the
 *   version rule no longer wants (their trophies, unless also earned cleanly in another regional
 *   list, and the version's platinum) is voided.
 */
export async function voidFraudEntries(
  userId: string,
  achievementIds: string[],
  now: Date = new Date(),
): Promise<number> {
  if (achievementIds.length === 0) return 0;
  const achievements = await prisma.achievement.findMany({
    where: { id: { in: achievementIds } },
    select: { id: true, gameId: true, platform: true, listId: true },
  });
  const listed = achievements.filter((a) => isListPlatform(a.platform));
  const listedIds = new Set(listed.map((a) => a.id));
  const steam = achievements.filter((a) => !listedIds.has(a.id));
  const steamIds = achievementIds.filter((id) => !listedIds.has(id));
  const platinumKeys = [...new Set(steam.map((a) => platinumSourceKey(a.platform, a.gameId)))];
  const unlocks = await prisma.userAchievement.findMany({
    where: { userId, achievementId: { in: achievementIds } },
    select: { unlockedAt: true },
  });

  const voided = await prisma.$transaction(async (tx) => {
    await tx.userAchievement.updateMany({
      where: { userId, achievementId: { in: achievementIds } },
      data: { suspicious: true },
    });
    for (const a of steam) {
      await tx.userGame.updateMany({
        where: { userId, gameId: a.gameId, platform: a.platform },
        data: { completedAt: null },
      });
    }
    const { count } = steamIds.length
      ? await tx.xpLedgerEntry.updateMany({
          where: {
            userId,
            voidedAt: null,
            OR: [
              { source: "achievement", sourceKey: { in: steamIds } },
              { source: "platinum", sourceKey: { in: platinumKeys } },
            ],
          },
          data: { voidedAt: now },
        })
      : { count: 0 };

    let listedVoided = 0;
    const listIds = [...new Set(listed.flatMap((a) => (a.listId ? [a.listId] : [])))];
    if (listIds.length > 0) {
      await tx.userTrophyList.updateMany({ where: { userId, listId: { in: listIds } }, data: { completedAt: null } });
    }
    for (const platform of LIST_PLATFORMS) {
      const gameIds = [...new Set(listed.filter((a) => a.platform === platform).map((a) => a.gameId))];
      for (const gameId of gameIds) await refreshGameCompletion(tx, userId, platform, gameId);
      listedVoided += (await settleListXp(tx, userId, platform, gameIds, now)).voided;
    }
    return count + listedVoided;
  }, TRANSACTION_OPTIONS);

  const days = [...new Set(unlocks.map((u) => toLocalDay(u.unlockedAt)))];
  const missionsVoided = await revalidateMissions(userId, days, now);

  await recomputeUser(userId, now);
  return voided + missionsVoided;
}
