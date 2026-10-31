import { prisma } from "@/lib/db";
import {
  generateMissions,
  missionProgress,
  type MissionCondition,
  type UnlockEvent,
} from "@/lib/engine/missions";
import { computeStreak, toLocalDay } from "@/lib/engine/streak";
import { SKILLS, type SkillId, type SkillState } from "@/lib/engine/types";
import { vocationFor } from "@/lib/engine/vocation";
import { levelFromXp } from "@/lib/engine/xp";
import { dailyPeriodKey, isoWeekKey, weeklyPeriodKey } from "./periods";
import { skillsFromLedger, type LedgerSkillEntry } from "./skills-from-ledger";

const DAY_MS = 86_400_000;
// Longest period start we may need (the Monday of the current ISO week) is under 7 days back.
const EVENT_LOOKBACK_DAYS = 8;
const TOP_SKILL_COUNT = 3;

type SkillMap = Record<SkillId, SkillState>;

/**
 * Current skills of the games behind `achievement` (sourceKey = achievementId) and `platinum`
 * (sourceKey = gameId) ledger entries, keyed by `${source}:${sourceKey}`.
 */
async function currentGameSkills(
  rows: { source: string; sourceKey: string }[],
): Promise<Map<string, string[]>> {
  const keysOf = (source: string) => rows.filter((r) => r.source === source).map((r) => r.sourceKey);
  const achievementIds = keysOf("achievement");
  const platinumGameIds = keysOf("platinum");
  if (achievementIds.length === 0 && platinumGameIds.length === 0) return new Map();

  const achievements = await prisma.achievement.findMany({
    where: { id: { in: achievementIds } },
    select: { id: true, gameId: true },
  });
  const games = await prisma.game.findMany({
    where: { id: { in: [...new Set([...platinumGameIds, ...achievements.map((a) => a.gameId)])] } },
    select: { id: true, skills: { select: { skill: true } } },
  });
  const skillsByGame = new Map(games.map((g) => [g.id, g.skills.map((s) => s.skill)]));

  // Entries whose achievement or game no longer exists are left out (they keep their copy).
  const result = new Map<string, string[]>();
  for (const a of achievements) {
    const skills = skillsByGame.get(a.gameId);
    if (skills) result.set(`achievement:${a.id}`, skills);
  }
  for (const id of platinumGameIds) {
    const skills = skillsByGame.get(id);
    if (skills) result.set(`platinum:${id}`, skills);
  }
  return result;
}

/**
 * Loads the ledger for the skill rebuild. XP is frozen at record time, but the genre mapping is
 * not: `achievement` and `platinum` entries without explicit `skillPoints` take the skills their
 * game has now (so a game that only later got skills, from the catalog job or an admin override,
 * also counts for past unlocks). Entries with explicit `skillPoints` (seed, guide votes) and
 * sources without a game keep their own `skills`. The `skills` column stays as an audit copy.
 */
async function loadLedger(userId: string) {
  const rows = await prisma.xpLedgerEntry.findMany({
    where: { userId },
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

async function loadUnlockEvents(userId: string, now: Date) {
  const rows = await prisma.userAchievement.findMany({
    where: { userId, unlockedAt: { gte: new Date(now.getTime() - EVENT_LOOKBACK_DAYS * DAY_MS) } },
    select: {
      unlockedAt: true,
      suspicious: true,
      achievementId: true,
      achievement: {
        select: {
          gameId: true,
          globalPct: true,
          game: { select: { skills: { select: { skill: true } } } },
        },
      },
    },
  });
  return rows.map(
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
  const events = await loadUnlockEvents(userId, now);
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
        completedAny = true;
      });
    }
  }
  return completedAny;
}

async function computeUserStreak(userId: string, now: Date) {
  const unlocks = await prisma.userAchievement.findMany({
    where: { userId, suspicious: false },
    select: { unlockedAt: true },
  });
  const days = new Set(unlocks.map((u) => toLocalDay(u.unlockedAt)));
  return computeStreak([...days], toLocalDay(now));
}

/**
 * Rebuilds everything derived from the XP ledger for one user: missions (create, progress,
 * payment), SkillProgress, total XP, level, vocation and streak. Safe to run any number of
 * times, also concurrently: the ledger is only ever appended to with unique keys.
 */
export async function recomputeUser(userId: string, now: Date = new Date()): Promise<void> {
  let { entries, totalXp } = await loadLedger(userId);
  let skills = skillsFromLedger(entries);

  if (await applyMissions(userId, now, topSkillsOf(skills))) {
    ({ entries, totalXp } = await loadLedger(userId));
    skills = skillsFromLedger(entries);
  }

  const streak = await computeUserStreak(userId, now);
  const stats = {
    totalXp,
    level: levelFromXp(totalXp).level,
    vocation: vocationFor(skills),
    streakCurrent: streak.current,
    streakBest: streak.best,
    shields: streak.shields,
  };

  await prisma.$transaction([
    ...SKILLS.map(({ id }) =>
      prisma.skillProgress.upsert({
        where: { userId_skill: { userId, skill: id } },
        create: { userId, skill: id, ...skills[id] },
        update: skills[id],
      }),
    ),
    prisma.userStats.upsert({
      where: { userId },
      create: { userId, ...stats },
      update: stats,
    }),
  ]);
}
