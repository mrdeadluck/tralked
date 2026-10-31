import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { dailyPeriodKey, weeklyPeriodKey } from "@/lib/progression/periods";
import {
  getCharacter,
  getHighscores,
  getUserRank,
  hoursUntilDailyReset,
  isHighscoreSkill,
} from "@/lib/queries/players";

describe("hoursUntilDailyReset", () => {
  it("counts whole hours to the next America/Sao_Paulo midnight", () => {
    // 18:00Z = 15:00 in Sao Paulo -> 9 h to midnight
    expect(hoursUntilDailyReset(new Date("2026-10-31T18:00:00Z"))).toBe(9);
    // 02:59:30Z = 23:59:30 local -> rounds up to 1 h, never 0
    expect(hoursUntilDailyReset(new Date("2026-11-01T02:59:30Z"))).toBe(1);
    // 03:00:00Z = 00:00 local -> a full day ahead
    expect(hoursUntilDailyReset(new Date("2026-11-01T03:00:00Z"))).toBe(24);
  });
});

describe("isHighscoreSkill", () => {
  it("accepts 'geral' and skill ids only", () => {
    expect(isHighscoreSkill("geral")).toBe(true);
    expect(isHighscoreSkill("soulslike")).toBe(true);
    expect(isHighscoreSkill("nope")).toBe(false);
  });
});

// These tests need Postgres up and seeded (see db.test.ts); skipped when unreachable.
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("player queries (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("getCharacter('lucas') is level 47 with the full sheet", async () => {
    const character = await getCharacter("lucas");
    expect(character?.level).toBe(47);
    expect(character?.skills).toHaveLength(11);
    expect(character?.skills[0]).toMatchObject({ id: "soulslike", level: 34 });
    expect(character?.skills.at(-1)?.id).toBe("sabio");
    expect(character?.streak.week).toHaveLength(7);
    expect(character?.streak.week.at(-1)?.today).toBe(true);
    expect(character?.recent.length).toBeLessThanOrEqual(6);
    expect(character?.recent.length).toBeGreaterThan(0);
    expect(character?.xpCurrent).toBeLessThan(character!.xpNext);
    expect(character?.stats.rank).toBeGreaterThan(0);
    for (const game of character!.almostThere) {
      expect(game.percent).toBeGreaterThanOrEqual(70);
      expect(game.percent).toBeLessThan(100);
    }
  });

  it("getCharacter lists the current daily and weekly missions (period keys from progression/periods)", async () => {
    const { prisma } = await import("@/lib/db");
    const now = new Date();
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const stored = await prisma.mission.findMany({
      where: { userId: lucas.id, periodKey: { in: [dailyPeriodKey(now), weeklyPeriodKey(now)] } },
    });
    const character = await getCharacter("lucas", now);
    const weekly = character!.missions.filter((m) => m.kind === "weekly");
    expect(weekly.length).toBeGreaterThan(0);
    expect(character!.missions.some((m) => m.kind === "daily")).toBe(true);
    expect(character!.missions.map((m) => m.id).sort()).toEqual(stored.map((m) => m.id).sort());
    for (const mission of weekly) expect(mission.goal).toBeGreaterThan(0);
  });
  it("getCharacter returns null for an unknown handle", async () => {
    expect(await getCharacter("ninguem-por-aqui")).toBeNull();
  });

  it("getHighscores('geral') is ordered by level desc, ranks are 1..n", async () => {
    const rows = await getHighscores("geral");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].level).toBeGreaterThanOrEqual(rows[i].level);
    }
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.some((r) => r.handle === "lucas")).toBe(true);
  });

  it("getHighscores(skill) is ordered by that skill's level desc and honors the limit", async () => {
    const rows = await getHighscores("soulslike", 5);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].level).toBeGreaterThanOrEqual(rows[i].level);
    }
  });

  it("a user with profilePublic=false does not appear and has no rank", async () => {
    const { prisma } = await import("@/lib/db");
    class Rollback extends Error {}
    const handle = `privado-teste-${Date.now()}`;
    const seen: Record<string, unknown> = {};
    // Runs inside a transaction that is rolled back, so other tests never see the fixture.
    await prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            steamId: `test-${handle}`,
            handle,
            displayName: handle,
            profilePublic: false,
            stats: { create: { totalXp: 999_999_999, level: 99, vocation: "Recruta" } },
            skills: { create: { skill: "soulslike", level: 99, points: 1 } },
          },
        });
        seen.inGeral = (await getHighscores("geral", 50, tx)).some((r) => r.handle === handle);
        seen.inSkill = (await getHighscores("soulslike", 50, tx)).some((r) => r.handle === handle);
        seen.rank = await getUserRank(user.id, "geral", tx);
        seen.sheetRank = (await getCharacter(handle, new Date(), tx))?.stats.rank;

        // Control: the same user, once public, tops both rankings.
        await tx.user.update({ where: { id: user.id }, data: { profilePublic: true } });
        seen.publicGeral = (await getHighscores("geral", 1, tx))[0]?.handle;
        seen.publicSkill = (await getHighscores("soulslike", 1, tx))[0]?.handle;
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen).toEqual({
      inGeral: false,
      inSkill: false,
      rank: null,
      sheetRank: null,
      publicGeral: handle,
      publicSkill: handle,
    });
    expect(await prisma.user.count({ where: { handle } })).toBe(0);
  });

  it("getUserRank matches the user's position in the listing", async () => {
    const { prisma } = await import("@/lib/db");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const rows = await getHighscores("geral", 500);
    const position = rows.findIndex((r) => r.handle === "lucas") + 1;
    expect((await getUserRank(lucas.id, "geral"))?.rank).toBe(position);
    const soulslike = await getHighscores("soulslike", 500);
    const skillPosition = soulslike.findIndex((r) => r.handle === "lucas") + 1;
    expect((await getUserRank(lucas.id, "soulslike"))?.rank).toBe(skillPosition);
  });
});
