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
 *
 * Plan 2 data: Steam LinkedAccount rows for every seeded user plus lucas's verified PSN, Xbox and
 * RetroAchievements accounts; PSN trophies / Xbox achievements for three games with lucas's
 * unlocks there (catalog + library only, no ledger entries, so his level stays 47); fixture media;
 * articles converted to ContentBlock[]; external headlines; forum; gallery; comments; a report;
 * notifications; and one example API key whose secret is discarded. Rows without a natural key
 * use fixed `seed-…` ids.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import hollowKnight from "../src/lib/integrations/steam/__fixtures__/hollow-knight.json";
import { prisma } from "../src/lib/db";
import { expFor, levelFromXp, xpForAchievement } from "../src/lib/engine/xp";
import { skillNeed, skillPointsFor } from "../src/lib/engine/skills";
import type { MissionCondition } from "../src/lib/engine/missions";
import { SKILLS, type SkillId, type SkillState } from "../src/lib/engine/types";
import { vocationFor } from "../src/lib/engine/vocation";
import { dailyPeriodKey, weeklyPeriodKey } from "../src/lib/progression/periods";
import { recomputeUser } from "../src/lib/progression/recompute";
import { hashPassword } from "../src/lib/auth/password";
import { recountAllArticleComments } from "../src/lib/community/comments";
import { skillsFromLedger } from "../src/lib/progression/skills-from-ledger";
import { markdownToBlocks } from "./seed-data/blocks";
import { RECOMMENDED_FEEDS } from "../src/lib/news/feed-catalog";
import {
  AREA_EXTERNAL_NEWS,
  COMMENTS,
  EXAMPLE_API_KEY,
  FORUM_CATEGORIES,
  FORUM_THREADS,
  HK_EXTERNAL_NEWS,
  LUCAS_NOTIFICATIONS,
  NEWS_FEEDS,
  PHOTOS,
  REPORTS,
} from "./seed-data/community";
import { FEED_ACHIEVEMENTS, GAMES, GAME_SLUG_BY_PREVIEW_ID } from "./seed-data/games";
import { HK_GUIDE } from "./seed-data/guides";
import { ARTICLES, AUTHOR_HANDLES } from "./seed-data/news";
import {
  FAMILY_MEMBER_HANDLES,
  LUCAS,
  LUCAS_DEV_LOGIN,
  LUCAS_LEVEL,
  LUCAS_LEVEL_FRACTION,
  LUCAS_SKILLS,
  LUCAS_SKILL_FRACTION,
  PLAYERS,
} from "./seed-data/users";
import { GAME_DETAILS, LUCAS_LINKED_ACCOUNTS, MEDIA_LAYOUT, PLATFORM_GAMES } from "./seed-data/platforms";

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

/** Preview streak of the other seeded players (by their index in PLAYERS). */
const playerStreak = (index: number) => ({ streakCurrent: 2 + (index % 6), streakBest: 10, shields: 0 });

function mustFind<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`Seed: missing ${what}`);
  return value;
}

export async function runSeed() {
  // Hashed outside the transaction (scrypt takes a moment).
  const lucasPasswordHash = await hashPassword(LUCAS_DEV_LOGIN.password);
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
          bio: "Perfil de demonstração do ambiente de desenvolvimento.",
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
        // Only lucas can log in with e-mail + password; the others stay without credentials, like
        // accounts of the old Steam login (reseeding resets an account recovered in a test).
        const credentials =
          u.handle === LUCAS.handle
            ? { email: LUCAS_DEV_LOGIN.email, passwordHash: lucasPasswordHash, googleSub: null }
            : { email: null, passwordHash: null, googleSub: null };
        // Seeded characters already have a history: their "Despertar" (first-sync sequence) was shown.
        const data = { ...u, ...credentials, lastSyncedAt: hoursAgo(2), despertarShownAt: daysAgo(400) };
        const row = await tx.user.upsert({
          where: { handle: u.handle },
          create: data,
          update: data,
        });
        userIds.set(u.handle, row.id);
      }
      const uid = (handle: string) => mustFind(userIds.get(handle), `user ${handle}`);
      const seededUserIds = [...userIds.values()];

      // ---------- Linked accounts ----------
      for (const u of allUsers) {
        const userId = uid(u.handle);
        const data = { externalId: u.steamId, handle: u.displayName, linkedAt: daysAgo(400), verifiedAt: daysAgo(400), lastSyncedAt: hoursAgo(2) };
        await tx.linkedAccount.upsert({
          where: { userId_platform: { userId, platform: "steam" } },
          create: { userId, platform: "steam", ...data },
          update: data,
        });
      }
      for (const a of LUCAS_LINKED_ACCOUNTS) {
        const userId = uid(LUCAS.handle);
        const data = {
          externalId: a.externalId,
          handle: a.handle,
          linkedAt: daysAgo(200),
          verifiedAt: daysAgo(200),
          verifyCode: null,
          verifyExpiresAt: null,
          lastSyncedAt: hoursAgo(3),
        };
        await tx.linkedAccount.upsert({
          where: { userId_platform: { userId, platform: a.platform } },
          create: { userId, platform: a.platform, ...data },
          update: data,
        });
      }

      // Wipe derived per-user rows of seeded users (recreated below).
      await tx.userAchievement.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.userGame.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.xpLedgerEntry.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.skillProgress.deleteMany({ where: { userId: { in: seededUserIds } } });
      await tx.mission.deleteMany({ where: { userId: { in: seededUserIds } } });

      // ---------- Games, skills, achievements ----------
      const gameIds = new Map<string, string>();
      for (const g of GAMES) {
        const details = GAME_DETAILS[g.slug];
        const data = {
          name: g.name,
          steamAppId: g.steamAppId,
          summary: g.summary,
          platforms: g.platforms,
          achievementCount: g.achievementCount,
          aliases: details?.aliases ?? [],
          developer: details?.developer ?? null,
          publisher: details?.publisher ?? null,
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

      // Platform ids (Steam appid for every game, example PSN/Xbox ids for three of them).
      const platformLinks = [
        ...GAMES.map((g) => ({ gameId: gid(g.slug), platform: "steam", externalId: String(g.steamAppId) })),
        ...PLATFORM_GAMES.map((p) => ({ gameId: gid(p.gameSlug), platform: p.platform, externalId: p.externalId })),
      ];
      for (const link of platformLinks) {
        await tx.gamePlatformLink.upsert({
          where: { platform_externalId: { platform: link.platform, externalId: link.externalId } },
          create: link,
          update: { gameId: link.gameId },
        });
      }

      // Fixture media (url null: the UI draws generated art).
      await tx.gameMedia.deleteMany({ where: { gameId: { in: [...gameIds.values()] }, source: "fixture" } });
      await tx.gameMedia.createMany({
        data: GAMES.flatMap((g) =>
          MEDIA_LAYOUT.flatMap((m) =>
            Array.from({ length: m.count }, (_, order) => ({
              gameId: gid(g.slug),
              kind: m.kind,
              url: null,
              youtubeId: null,
              width: m.width,
              height: m.height,
              source: "fixture",
              order,
            })),
          ),
        ),
      });

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
          where: { gameId_platform_apiName: { gameId: hkGameId, platform: "steam", apiName: a.apiName } },
          create: { gameId: hkGameId, platform: "steam", apiName: a.apiName, ...data },
          update: data,
        });
        achievementIds.set(`hollow-knight:${a.apiName}`, row.id);
        achievementByName.set(a.name, a.apiName);
      }
      for (const f of FEED_ACHIEVEMENTS) {
        const data = { name: f.name, globalPct: f.globalPct, hidden: false };
        const row = await tx.achievement.upsert({
          where: {
            gameId_platform_apiName: { gameId: gid(f.gameSlug), platform: "steam", apiName: f.apiName },
          },
          create: { gameId: gid(f.gameSlug), platform: "steam", apiName: f.apiName, ...data },
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
      const today = dailyPeriodKey(now);
      const week = weeklyPeriodKey(now);
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
        { kind: "daily", periodKey: today, title: "Desbloqueie 5 conquistas", condition: { minCount: 5 }, rewardXp: 8000, progress: 2 },
        { kind: "weekly", periodKey: week, title: "Desbloqueie 10 conquistas de Survival Horror", condition: { minCount: 10, skill: "horror" }, rewardXp: 40000, progress: 6 },
        { kind: "weekly", periodKey: week, title: "Desbloqueie 10 conquistas raras", condition: { minCount: 10, maxGlobalPct: 20 }, rewardXp: 50000, progress: 4 },
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
          ...playerStreak(PLAYERS.indexOf(p)),
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

      // ---------- PSN trophies / Xbox achievements and lucas's progress there ----------
      // Catalog and library only: no ledger entries, so lucas's XP and level stay as above.
      for (const pg of PLATFORM_GAMES) {
        const gameId = gid(pg.gameSlug);
        const ids: string[] = [];
        for (const { apiName, trophy } of pg.achievements) {
          const data = {
            name: trophy.name,
            globalPct: trophy.globalPct,
            hidden: false,
            trophyTier: trophy.tier ?? null,
            points: trophy.points ?? null,
          };
          const row = await tx.achievement.upsert({
            where: { gameId_platform_apiName: { gameId, platform: pg.platform, apiName } },
            create: { gameId, platform: pg.platform, apiName, ...data },
            update: data,
          });
          ids.push(row.id);
        }
        if (pg.lucasPlaytimeMin === 0) continue;
        const unlockedAt = daysAgo(pg.lucasDaysAgo);
        await tx.userAchievement.createMany({
          data: pg.lucasUnlocked.map((i, n) => ({
            userId: lucasId,
            achievementId: ids[i],
            unlockedAt: new Date(unlockedAt.getTime() + n * HOUR),
          })),
        });
        const complete = pg.lucasUnlocked.length === pg.achievements.length;
        await tx.userGame.create({
          data: {
            userId: lucasId,
            gameId,
            platform: pg.platform,
            playtimeMin: pg.lucasPlaytimeMin,
            unlockedCount: pg.lucasUnlocked.length,
            completedAt: complete
              ? new Date(unlockedAt.getTime() + (pg.lucasUnlocked.length - 1) * HOUR)
              : null,
          },
        });
      }

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
      const articleIds = new Map<string, string>();
      for (const a of ARTICLES) {
        const gameId = a.previewGameId ? gid(GAME_SLUG_BY_PREVIEW_ID[a.previewGameId]) : null;
        const data = {
          title: a.title,
          subtitle: a.subtitle,
          excerpt: a.subtitle,
          body: a.body,
          blocks: markdownToBlocks(a.body),
          status: "published",
          source: "editorial",
          category: a.category,
          platforms: a.platforms,
          imageLabel: a.imageLabel,
          authorId: mustFind(authorIds.get(a.authorHandle), `author ${a.authorHandle}`),
          gameId,
          featured: a.featured,
          likes: a.likes,
          comments: a.comments,
          humanAuthored: true,
          publishedAt: hoursAgo(a.agoHours),
          firstPublishedAt: hoursAgo(a.agoHours),
        };
        const article = await tx.article.upsert({
          where: { slug: a.slug },
          create: { slug: a.slug, ...data },
          update: data,
        });
        articleIds.set(a.slug, article.id);
        await tx.articleGame.deleteMany({ where: { articleId: article.id } });
        if (gameId) await tx.articleGame.create({ data: { articleId: article.id, gameId } });
      }

      // ---------- External headlines ----------
      for (const f of NEWS_FEEDS) {
        // Placeholder URLs: inactive so no job ever fetches them.
        await tx.newsFeed.upsert({
          where: { url: f.url },
          create: { ...f, active: false },
          update: { name: f.name, active: false },
        });
      }
      // Plan 4 F7: the curated Entretenimento/Tecnologia feeds, paused so dev and tests never
      // fetch the internet (`pnpm news:feeds` adds them active on a real database). An edit made
      // in the admin (active, name) is kept on a re-seed.
      for (const f of RECOMMENDED_FEEDS) {
        await tx.newsFeed.upsert({
          where: { url: f.url },
          create: { name: f.name, url: f.url, area: f.area, active: false },
          update: { area: f.area },
        });
      }
      for (const n of AREA_EXTERNAL_NEWS) {
        const data = {
          gameId: n.gameSlug ? gid(n.gameSlug) : null,
          title: n.title,
          source: n.source,
          area: n.area,
          publishedAt: hoursAgo(n.agoHours),
        };
        await tx.externalNews.upsert({
          where: { url: n.url },
          create: { url: n.url, ...data, fetchedAt: hoursAgo(1) },
          update: data,
        });
      }
      for (const n of HK_EXTERNAL_NEWS) {
        const data = { gameId: hkGameId, title: n.title, source: n.source, publishedAt: hoursAgo(n.agoHours) };
        await tx.externalNews.upsert({
          where: { url: n.url },
          create: { url: n.url, ...data, fetchedAt: hoursAgo(1) },
          update: data,
        });
      }

      // ---------- Hollow Knight guide ----------
      const apiNameOf = (name: string) =>
        mustFind(achievementByName.get(name), `Hollow Knight achievement "${name}"`);
      const guideData = {
        authorId: uid(HK_GUIDE.authorHandle),
        source: "editorial",
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

      // ---------- Forum ----------
      const categoryIds = new Map<string, string>();
      for (const c of FORUM_CATEGORIES) {
        const row = await tx.forumCategory.upsert({ where: { slug: c.slug }, create: c, update: c });
        categoryIds.set(c.slug, row.id);
      }
      for (const t of FORUM_THREADS) {
        const thread = {
          categoryId: t.categorySlug ? mustFind(categoryIds.get(t.categorySlug), `category ${t.categorySlug}`) : null,
          gameId: t.gameSlug ? gid(t.gameSlug) : null,
          authorId: uid(t.authorHandle),
          title: t.title,
          slug: t.slug,
          status: "open",
          pinned: t.pinned,
          solvedPostId: null,
          createdAt: hoursAgo(t.agoHours),
          lastPostAt: hoursAgo(Math.min(...t.posts.map((p) => p.agoHours))),
        };
        await tx.forumThread.upsert({ where: { id: t.id }, create: { id: t.id, ...thread }, update: thread });
        for (const p of t.posts) {
          const post = {
            threadId: t.id,
            authorId: uid(p.authorHandle),
            body: p.body,
            status: "visible",
            createdAt: hoursAgo(p.agoHours),
            editedAt: null,
          };
          await tx.forumPost.upsert({ where: { id: p.id }, create: { id: p.id, ...post }, update: post });
        }
        if (t.solvedPostId) {
          await tx.forumThread.update({ where: { id: t.id }, data: { solvedPostId: t.solvedPostId } });
        }
      }

      // ---------- Gallery ----------
      for (const ph of PHOTOS) {
        const photo = {
          authorId: uid(ph.authorHandle),
          gameId: gid(ph.gameSlug),
          url: null,
          width: ph.width,
          height: ph.height,
          caption: ph.caption,
          status: "visible",
          createdAt: hoursAgo(ph.agoHours),
          likeCount: ph.likedBy.length,
        };
        await tx.photo.upsert({ where: { id: ph.id }, create: { id: ph.id, ...photo }, update: photo });
      }
      await tx.photoLike.deleteMany({ where: { photoId: { in: PHOTOS.map((ph) => ph.id) } } });
      await tx.photoLike.createMany({
        data: PHOTOS.flatMap((ph) =>
          ph.likedBy.map((handle, i) => ({
            userId: uid(handle),
            photoId: ph.id,
            createdAt: hoursAgo(ph.agoHours - (i + 1) * 0.1),
          })),
        ),
      });

      // ---------- Comments, reports, notifications ----------
      for (const c of COMMENTS) {
        const target =
          c.target.type === "article"
            ? mustFind(articleIds.get(c.target.slug), `article ${c.target.slug}`)
            : c.target.type === "guide"
              ? guide.id
              : c.target.id;
        const comment = {
          authorId: uid(c.authorHandle),
          targetType: c.target.type,
          targetId: target,
          body: c.body,
          status: c.status ?? "visible",
          createdAt: hoursAgo(c.agoHours),
          editedAt: null,
        };
        await tx.comment.upsert({ where: { id: c.id }, create: { id: c.id, ...comment }, update: comment });
      }
      for (const r of REPORTS) {
        const report = {
          reporterId: uid(r.reporterHandle),
          targetType: "comment",
          targetId: r.commentId,
          reason: r.reason,
          status: "open",
          createdAt: hoursAgo(r.agoHours),
          resolvedAt: null,
          resolvedById: null,
        };
        await tx.report.upsert({ where: { id: r.id }, create: { id: r.id, ...report }, update: report });
      }
      for (const n of LUCAS_NOTIFICATIONS) {
        const notification = {
          userId: lucasId,
          kind: n.kind,
          title: n.title,
          body: n.body ?? null,
          href: n.href ?? null,
          readAt: n.read ? hoursAgo(n.agoHours - 1) : null,
          createdAt: hoursAgo(n.agoHours),
        };
        await tx.notification.upsert({
          where: { id: n.id },
          create: { id: n.id, ...notification },
          update: notification,
        });
      }

      // ---------- Example bot key ----------
      // The hash is of a random value that is thrown away: no usable secret exists for this key.
      const { id: apiKeyId, ...apiKey } = EXAMPLE_API_KEY;
      await tx.apiKey.upsert({
        where: { id: apiKeyId },
        create: {
          id: apiKeyId,
          ...apiKey,
          hash: createHash("sha256").update(randomBytes(32)).digest("hex"),
          createdById: lucasId,
        },
        update: { ...apiKey, revokedAt: null },
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  // Rows the app derives (AttributeProgress, today's missions) come from the real recompute, so the
  // seeded characters look like synced ones. XP, level and skills come out unchanged (the ledger
  // reproduces them). The streaks are the preview's: the baseline entries stand in for unlocks that
  // are not seeded, so the recomputed streak would be ~0; they are put back afterwards.
  const streaks = new Map([
    [LUCAS.handle, { streakCurrent: LUCAS.streakCurrent, streakBest: LUCAS.streakBest, shields: LUCAS.shields }],
    ...PLAYERS.map((p, i) => [p.handle, playerStreak(i)] as const),
  ]);
  const seeded = await prisma.user.findMany({
    where: { handle: { in: [...streaks.keys()] } },
    select: { id: true, handle: true },
  });
  for (const { id, handle } of seeded) {
    await recomputeUser(id, now);
    await prisma.userStats.update({ where: { userId: id }, data: mustFind(streaks.get(handle), `streak ${handle}`) });
  }

  // Article.comments follows the visible comments (the preview's numbers were decoration).
  await recountAllArticleComments(prisma);

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
