/**
 * Idempotent development seed: `pnpm db:seed`.
 *
 * Catalog rows (games, achievements, articles, guide) are upserted by natural key;
 * per-user derived rows of the seeded users are deleted and recreated, so running the
 * seed twice yields the same data. Everything is written in one transaction.
 *
 * Ledger notes (lucas): real `achievement` entries are written for every achievement he
 * has unlocked in the seed (Hollow Knight fixture + the preview's recent feed); their skill
 * points are derived (`skillPoints: null`). The rest of his XP and skill points up to the
 * preview's state comes from ONE synthetic entry `source: 'seed'`, `sourceKey: 'baseline'`
 * with explicit `skillPoints` (it stands in for the other ~1,200 preview achievements).
 * SkillProgress rows are exactly `skillsFromLedger(ledger)`; the seed throws if that differs
 * from the target levels. The other players get a single `seed` baseline entry each.
 */
import { pathToFileURL } from "node:url";
import hollowKnight from "../src/lib/integrations/steam/__fixtures__/hollow-knight.json";
import { prisma } from "../src/lib/db";
import { expFor, levelFromXp, xpForAchievement } from "../src/lib/engine/xp";
import { skillNeed, skillPointsFor } from "../src/lib/engine/skills";
import { toLocalDay } from "../src/lib/engine/streak";
import type { MissionCondition } from "../src/lib/engine/missions";
import { SKILLS, type SkillId, type SkillState } from "../src/lib/engine/types";
import { vocationFor } from "../src/lib/engine/vocation";
import { skillsFromLedger } from "../src/lib/progression/skills-from-ledger";
import { FEED_ACHIEVEMENTS, GAMES, GAME_SLUG_BY_PREVIEW_ID } from "./seed-data/games";
import { HK_GUIDE } from "./seed-data/guides";
import { ARTICLES, AUTHOR_HANDLES } from "./seed-data/news";
import {
  FAMILY_MEMBER_HANDLES,
  LUCAS,
  LUCAS_LEVEL,
  LUCAS_LEVEL_FRACTION,
  LUCAS_SKILLS,
  LUCAS_SKILL_FRACTION,
  PLAYERS,
} from "./seed-data/users";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR);
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

const SKILL_IDS = SKILLS.map((s) => s.id);

function skillStates(levels: Record<SkillId, number>, fraction: (id: SkillId) => number) {
  return Object.fromEntries(
    SKILL_IDS.map((id) => [
      id,
      { level: levels[id], points: Math.round(skillNeed(levels[id]) * fraction(id)) },
    ]),
  ) as Record<SkillId, SkillState>;
}

/** Total points a skill needs to be at `state`, counted from level 1 with 0 points. */
function totalPointsFor(state: SkillState): number {
  let total = state.points;
  for (let level = 1; level < state.level; level++) total += skillNeed(level);
  return total;
}

/**
 * Explicit per-skill points for a baseline entry: the target totals minus what the
 * already-derived entries contribute. Throws if the derived entries overshoot.
 */
function baselineSkillPoints(
  target: Record<SkillId, SkillState>,
  derived: { xp: number; skills: string[] }[],
): Record<string, number> {
  const have: Record<string, number> = {};
  for (const e of derived) {
    for (const skill of e.skills) {
      have[skill] = (have[skill] ?? 0) + skillPointsFor(e.xp, e.skills.length);
    }
  }
  const result: Record<string, number> = {};
  for (const id of SKILL_IDS) {
    const missing = totalPointsFor(target[id]) - (have[id] ?? 0);
    if (missing < 0) throw new Error(`Seed: derived points exceed target for ${id}`);
    if (missing > 0) result[id] = missing;
  }
  return result;
}

function assertSkillsMatch(
  who: string,
  ledger: { xp: number; skills: string[]; skillPoints: Record<string, number> | null }[],
  target: Record<SkillId, SkillState>,
) {
  const rebuilt = skillsFromLedger(ledger);
  for (const id of SKILL_IDS) {
    if (rebuilt[id].level !== target[id].level || rebuilt[id].points !== target[id].points) {
      throw new Error(`Seed: ledger of ${who} does not reproduce skill ${id}`);
    }
  }
}

/** Monday (America/Sao_Paulo) of the current week, 'YYYY-MM-DD'. */
function weekKey(date: Date): string {
  const day = toLocalDay(date);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return toLocalDay(new Date(new Date(`${day}T12:00:00Z`).getTime() - back * DAY));
}

function mustFind<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`Seed: missing ${what}`);
  return value;
}

export async function runSeed() {
  await prisma.$transaction(
    async (tx) => {
      // ---------- Users ----------
      const userIds = new Map<string, string>();
      const allUsers = [
        {
          handle: LUCAS.handle,
          displayName: LUCAS.displayName,
          steamId: LUCAS.steamId,
          role: LUCAS.role,
          profilePublic: LUCAS.profilePublic,
        },
        ...PLAYERS.map((p) => ({
          handle: p.handle,
          displayName: p.displayName,
          steamId: p.steamId,
          role: p.role,
          profilePublic: p.profilePublic,
        })),
      ];
      for (const u of allUsers) {
        const row = await tx.user.upsert({
          where: { handle: u.handle },
          create: { ...u, lastSyncedAt: hoursAgo(2) },
          update: { ...u, lastSyncedAt: hoursAgo(2) },
        });
        userIds.set(u.handle, row.id);
      }
      const uid = (handle: string) => mustFind(userIds.get(handle), `user ${handle}`);
      const seededUserIds = [...userIds.values()];

      // Wipe derived per-user rows of seeded users (recreated below).
      await tx.userAchievement.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.userGame.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.xpLedgerEntry.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.skillProgress.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.mission.deleteMany({ where: { userId: { in: seededUserIds } } });

      // ---------- Games, skills, achievements ----------
      const gameIds = new Map<string, string>();
      for (const g of GAMES) {
        const data = {
          name: g.name,
          steamAppId: g.steamAppId,
          summary: g.summary,
          platforms: g.platforms,
          achievementCount: g.achievementCount,
        };
        const row = await tx.game.upsert({
          where: { slug: g.slug },
          create: { slug: g.slug, ...data },
          update: data,
        });
        gameIds.set(g.slug, row.id);
        await tx.gameSkill.deleteMany({ where: { gameId: row.id } });
        await tx.gameSkill.createMany({
          data: g.skills.map((skill) => ({ gameId: row.id, skill })),
        });
      }
      const gid = (slug: string) => mustFind(gameIds.get(slug), `game ${slug}`);

      // Hollow Knight achievements come from the Steam fixture, so seed and fixtures agree.
      const hkGameId = gid("hollow-knight");
      const achievementIds = new Map<string, string>(); // `${gameSlug}:${apiName}` -> id
      const achievementByName = new Map<string, string>(); // HK name -> apiName
      for (const a of hollowKnight.schema) {
        const globalPct =
          (hollowKnight.globalPercentages as Record<string, number>)[a.apiName] ?? null;
        const data = {
          name: a.name,
          description: a.description ?? null,
          iconUrl: a.iconUrl ?? null,
          hidden: a.hidden,
          globalPct,
        };
        const row = await tx.achievement.upsert({
          where: { gameId_apiName: { gameId: hkGameId, apiName: a.apiName } },
          create: { gameId: hkGameId, apiName: a.apiName, ...data },
          update: data,
        });
        achievementIds.set(`hollow-knight:${a.apiName}`, row.id);
        achievementByName.set(a.name, a.apiName);
      }
      for (const f of FEED_ACHIEVEMENTS) {
        const data = { name: f.name, globalPct: f.globalPct, hidden: false };
        const row = await tx.achievement.upsert({
          where: { gameId_apiName: { gameId: gid(f.gameSlug), apiName: f.apiName } },
          create: { gameId: gid(f.gameSlug), apiName: f.apiName, ...data },
          update: data,
        });
        achievementIds.set(`${f.gameSlug}:${f.apiName}`, row.id);
      }

      // ---------- lucas: unlocks, ledger, skills, stats ----------
      const lucasId = uid(LUCAS.handle);
      const skillsOfGame = (slug: string) =>
        mustFind(GAMES.find((g) => g.slug === slug), `game ${slug}`).skills;

      type Unlock = {
        gameSlug: string;
        apiName: string;
        globalPct: number | null;
        unlockedAt: Date;
      };
      const unlocks: Unlock[] = [
        ...hollowKnight.playerUnlocks
          .filter((u) => u.unlockTime > 0)
          .map((u) => ({
            gameSlug: "hollow-knight",
            apiName: u.apiName,
            globalPct:
              (hollowKnight.globalPercentages as Record<string, number>)[u.apiName] ?? null,
            unlockedAt: new Date(u.unlockTime * 1000),
          })),
        ...FEED_ACHIEVEMENTS.map((f) => ({
          gameSlug: f.gameSlug,
          apiName: f.apiName,
          globalPct: f.globalPct,
          unlockedAt: hoursAgo(f.agoHours),
        })),
      ];

      await tx.userAchievement.createMany({
        data: unlocks.map((u) => ({
          userId: lucasId,
          achievementId: mustFind(
            achievementIds.get(`${u.gameSlug}:${u.apiName}`),
            `achievement ${u.gameSlug}:${u.apiName}`,
          ),
          unlockedAt: u.unlockedAt,
        })),
      });

      const lucasTotalXp =
        expFor(LUCAS_LEVEL) +
        Math.round((expFor(LUCAS_LEVEL + 1) - expFor(LUCAS_LEVEL)) * LUCAS_LEVEL_FRACTION);
      const lucasSkills = skillStates(LUCAS_SKILLS, (id) => LUCAS_SKILL_FRACTION[id]);
      const achievementEntries = unlocks.map((u) => ({
        userId: lucasId,
        source: "achievement",
        // Same key as the sync pipeline (achievementId), so a later sync never double-counts.
        sourceKey: mustFind(
          achievementIds.get(`${u.gameSlug}:${u.apiName}`),
          `achievement ${u.gameSlug}:${u.apiName}`,
        ),
        xp: xpForAchievement(u.globalPct),
        skills: skillsOfGame(u.gameSlug),
        createdAt: u.unlockedAt,
      }));
      const achievementXp = achievementEntries.reduce((sum, e) => sum + e.xp, 0);
      const baselineXp = lucasTotalXp - achievementXp;
      if (baselineXp < 0) throw new Error("Seed: lucas's real unlocks exceed his target XP");
      const baselinePoints = baselineSkillPoints(lucasSkills, achievementEntries);
      assertSkillsMatch(
        "lucas",
        [
          ...achievementEntries.map((e) => ({ ...e, skillPoints: null })),
          { xp: baselineXp, skills: Object.keys(baselinePoints), skillPoints: baselinePoints },
        ],
        lucasSkills,
      );
      await tx.xpLedgerEntry.createMany({
        data: [
          ...achievementEntries,
          {
            userId: lucasId,
            source: "seed",
            sourceKey: "baseline",
            xp: baselineXp,
            skills: Object.keys(baselinePoints),
            skillPoints: baselinePoints,
            createdAt: daysAgo(400),
          },
        ],
      });

      const lucasLevel = levelFromXp(lucasTotalXp).level;
      if (lucasLevel !== LUCAS_LEVEL) {
        throw new Error(`Seed: lucas ended at level ${lucasLevel}, expected ${LUCAS_LEVEL}`);
      }
      await tx.skillProgress.createMany({
        data: SKILL_IDS.map((id) => ({ userId: lucasId, skill: id, ...lucasSkills[id] })),
      });
      const lucasStats = {
        totalXp: lucasTotalXp,
        level: lucasLevel,
        vocation: vocationFor(lucasSkills),
        streakCurrent: LUCAS.streakCurrent,
        streakBest: LUCAS.streakBest,
        shields: LUCAS.shields,
      };
      await tx.userStats.upsert({
        where: { userId: lucasId },
        create: { userId: lucasId, ...lucasStats },
        update: lucasStats,
      });

      // Missions (preview `S.missions`).
      const today = toLocalDay(now);
      const missions: {
        kind: "daily" | "weekly";
        periodKey: string;
        title: string;
        condition: MissionCondition;
        rewardXp: number;
        progress: number;
      }[] = [
        { kind: "daily", periodKey: today, title: "Desbloqueie 3 conquistas raras", condition: { minCount: 3, maxGlobalPct: 20 }, rewardXp: 12000, progress: 1 },
        { kind: "daily", periodKey: today, title: "Ganhe XP em Soulslike", condition: { minCount: 1, skill: "soulslike" }, rewardXp: 5000, progress: 0 },
        { kind: "weekly", periodKey: weekKey(now), title: "Desbloqueie 10 conquistas de Survival Horror", condition: { minCount: 10, skill: "horror" }, rewardXp: 40000, progress: 6 },
      ];
      await tx.mission.createMany({ data: missions.map((m) => ({ userId: lucasId, ...m })) });

      // ---------- Other players: baseline ledger, skills, stats ----------
      for (const p of PLAYERS) {
        const id = uid(p.handle);
        const states = skillStates(p.skills, () => 0.5);
        const totalXp =
          expFor(p.level) + Math.round((expFor(p.level + 1) - expFor(p.level)) * 0.5);
        const points = baselineSkillPoints(states, []);
        assertSkillsMatch(
          p.handle,
          [{ xp: totalXp, skills: Object.keys(points), skillPoints: points }],
          states,
        );
        await tx.xpLedgerEntry.create({
          data: {
            userId: id,
            source: "seed",
            sourceKey: "baseline",
            xp: totalXp,
            skills: Object.keys(points),
            skillPoints: points,
            createdAt: daysAgo(400),
          },
        });
        await tx.skillProgress.createMany({
          data: SKILL_IDS.map((skill) => ({ userId: id, skill, ...states[skill] })),
        });
        const stats = {
          totalXp,
          level: levelFromXp(totalXp).level,
          vocation: vocationFor(states),
          streakCurrent: 2 + (PLAYERS.indexOf(p) % 6),
          streakBest: 10,
          shields: 0,
        };
        await tx.userStats.upsert({
          where: { userId: id },
          create: { userId: id, ...stats },
          update: stats,
        });
      }

      // ---------- Libraries ----------
      await tx.userGame.createMany({
        data: GAMES.map((g) => ({
          userId: lucasId,
          gameId: gid(g.slug),
          playtimeMin: g.lucasPlaytimeMin,
          unlockedCount: g.lucasUnlocked,
          completedAt: g.lucasUnlocked === g.achievementCount ? daysAgo(30) : null,
        })),
      });
      // Deterministic subsets so family libraries overlap only partially.
      await tx.userGame.createMany({
        data: PLAYERS.flatMap((p, pi) =>
          GAMES.flatMap((g, gi) =>
            (gi + pi) % 3 === 0
              ? []
              : [
                  {
                    userId: uid(p.handle),
                    gameId: gid(g.slug),
                    playtimeMin: 600 + ((gi * 37 + pi * 91) % 40) * 60,
                    unlockedCount: Math.round(
                      g.achievementCount * (((gi * 7 + pi * 13) % 9) + 1) * 0.1,
                    ),
                    completedAt: null,
                  },
                ],
          ),
        ),
      });

      // ---------- Authors and news ----------
      const authorIds = new Map<string, string>();
      for (const handle of AUTHOR_HANDLES) {
        const userId = userIds.get(handle) ?? null;
        const row = await tx.author.upsert({
          where: { handle },
          create: { handle, userId },
          update: { userId },
        });
        authorIds.set(handle, row.id);
      }
      for (const a of ARTICLES) {
        const data = {
          title: a.title,
          subtitle: a.subtitle,
          body: a.body,
          category: a.category,
          platforms: a.platforms,
          imageLabel: a.imageLabel,
          authorId: mustFind(authorIds.get(a.authorHandle), `author ${a.authorHandle}`),
          gameId: a.previewGameId ? gid(GAME_SLUG_BY_PREVIEW_ID[a.previewGameId]) : null,
          featured: a.featured,
          likes: a.likes,
          comments: a.comments,
          humanAuthored: true,
          publishedAt: hoursAgo(a.agoHours),
        };
        await tx.article.upsert({
          where: { slug: a.slug },
          create: { slug: a.slug, ...data },
          update: data,
        });
      }

      // ---------- Hollow Knight guide ----------
      const apiNameOf = (name: string) =>
        mustFind(achievementByName.get(name), `Hollow Knight achievement "${name}"`);
      const guideData = {
        authorId: uid(HK_GUIDE.authorHandle),
        status: HK_GUIDE.status,
        version: HK_GUIDE.version,
        difficulty: HK_GUIDE.difficulty,
        hoursMin: HK_GUIDE.hoursMin,
        hoursMax: HK_GUIDE.hoursMax,
        playthroughs: HK_GUIDE.playthroughs,
        missables: HK_GUIDE.missables,
        online: HK_GUIDE.online,
        overview: HK_GUIDE.overview,
        warnings: HK_GUIDE.warnings,
        collectibles: HK_GUIDE.collectibles,
        usefulCount: HK_GUIDE.usefulCount,
        publishedAt: daysAgo(mustFind(HK_GUIDE.revisions.at(-1), "first revision").agoDays),
      };
      const guide = await tx.guide.upsert({
        where: { gameId: hkGameId },
        create: { gameId: hkGameId, ...guideData },
        update: guideData,
      });
      // Children are replaced wholesale (cascades clear step progress and votes).
      await tx.guideStep.deleteMany({ where: { guideId: guide.id } });
      await tx.guideAchievementNote.deleteMany({ where: { guideId: guide.id } });
      await tx.guideTip.deleteMany({ where: { guideId: guide.id } });
      await tx.guideRevision.deleteMany({ where: { guideId: guide.id } });

      const steps: { id: string }[] = [];
      for (const [order, s] of HK_GUIDE.steps.entries()) {
        steps.push(
          await tx.guideStep.create({
            data: {
              guideId: guide.id,
              order,
              title: s.title,
              hours: s.hours,
              body: s.body,
              achievementApiNames: s.achievements.map(apiNameOf),
            },
          }),
        );
      }
      await tx.guideAchievementNote.createMany({
        data: HK_GUIDE.notes.map((n) => ({
          guideId: guide.id,
          achievementId: mustFind(
            achievementIds.get(`hollow-knight:${apiNameOf(n.name)}`),
            `achievement ${n.name}`,
          ),
          category: n.category,
          spoiler: n.spoiler ?? false,
          tip: n.tip,
          steps: n.steps ?? [],
        })),
      });
      for (const t of HK_GUIDE.tips) {
        await tx.guideTip.create({
          data: { guideId: guide.id, authorId: uid(t.handle), body: t.body, votes: t.votes },
        });
      }
      await tx.guideRevision.createMany({
        data: HK_GUIDE.revisions.map((r) => ({
          guideId: guide.id,
          version: r.version,
          summary: r.summary,
          authorId: uid(r.handle),
          createdAt: daysAgo(r.agoDays),
        })),
      });
      await tx.guideStepProgress.createMany({
        data: HK_GUIDE.lucasStepsDone.map((i) => ({
          userId: lucasId,
          stepId: steps[i].id,
        })),
      });

      // ---------- Família Lucas ----------
      const familyName = "Família Lucas";
      const existing = await tx.family.findFirst({ where: { name: familyName, ownerId: lucasId } });
      const family =
        existing ??
        (await tx.family.create({ data: { name: familyName, ownerId: lucasId } }));
      await tx.familyMember.deleteMany({ where: { familyId: family.id } });
      await tx.familyMember.createMany({
        data: [
          { familyId: family.id, userId: lucasId, role: "owner", joinedAt: daysAgo(60) },
          ...FAMILY_MEMBER_HANDLES.map((h, i) => ({
            familyId: family.id,
            userId: uid(h),
            role: "member",
            joinedAt: daysAgo(40 - i * 10),
          })),
        ],
      });
      const inviteToken = "convite-demo-familia-lucas";
      await tx.familyInvite.upsert({
        where: { token: inviteToken },
        create: { familyId: family.id, token: inviteToken, expiresAt: new Date(now.getTime() + 7 * DAY) },
        update: { familyId: family.id, expiresAt: new Date(now.getTime() + 7 * DAY), usedAt: null },
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const [games, articles, users] = await Promise.all([
    prisma.game.count(),
    prisma.article.count(),
    prisma.user.count(),
  ]);
  console.log(`Seed ok: ${games} games, ${articles} articles, ${users} users.`);
}

// Run only when executed directly (`tsx prisma/seed.ts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
