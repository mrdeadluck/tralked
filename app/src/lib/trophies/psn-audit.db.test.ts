import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { PsnApi, PsnTitle } from "@/lib/integrations/psn/types";
import { auditPsnLists } from "./psn-audit";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-b5a` prefix and are removed.
const PREFIX = "test-b5a";
const icon = (list: string) => `https://image.api.playstation.com/trophy/np/${list}_00AA/x.PNG`;

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

const title = (npTitleId: string, counts: Partial<PsnTitle["trophyCounts"]>): PsnTitle => ({
  npTitleId,
  serviceName: "trophy",
  name: npTitleId,
  platform: "PS4",
  progress: 0,
  trophyCounts: { bronze: 0, silver: 0, gold: 0, platinum: 0, ...counts },
  earnedCounts: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
  lastPlayed: null,
});

const unused = () => {
  throw new Error("not used by the audit");
};
function fakePsn(byAccount: Record<string, PsnTitle[] | "private">): PsnApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    findProfile: unused,
    getTrophies: unused,
    getPlayedGames: unused,
    getTrophyListsOfTitles: unused,
    getListInfo: unused,
    getListTrophies: unused,
    async getTitles(accountId) {
      calls.push(accountId);
      return byAccount[accountId] ?? [];
    },
  };
}

/** A psn list with rows of these tiers (icons of `iconList`, its own id by default). */
async function list(externalId: string, tiers: string[], trophyCount = tiers.length, iconList = externalId) {
  const game = await prisma.game.create({
    data: { slug: `${PREFIX}-${externalId.toLowerCase()}`, name: externalId, achievementCount: 0, platforms: ["PS4"] },
  });
  const l = await prisma.trophyList.create({
    data: { gameId: game.id, platform: "psn", externalId, console: "PS4", name: externalId, trophyCount },
  });
  await prisma.achievement.createMany({
    data: tiers.map((trophyTier, i) => ({
      gameId: game.id,
      platform: "psn",
      listId: l.id,
      apiName: String(i),
      name: `T${i}`,
      trophyTier,
      iconUrl: icon(iconList),
    })),
  });
  return l;
}

describe("auditPsnLists", () => {
  beforeAll(async () => {
    await cleanup();
    // The Guns, Gore and Cannoli case: Sony defines 3 bronze; stored are another list's trophies.
    await list("NPWR99001_00", ["platinum", "gold", "silver", "bronze"], 4, "NPWR99009_00");
    await list("NPWR99002_00", ["bronze", "bronze"]);
    // Same count, other tiers.
    await list("NPWR99003_00", ["gold", "bronze"]);
    // Not in any account's titles: only the stored checks (icons, trophyCount) apply.
    await list("NPWR99004_00", ["bronze"], 1, "NPWR99008_00");
    await list("NPWR99005_00", ["bronze", "bronze"], 3);
    for (const [name, externalId] of [["a", "acc-a"], ["b", "acc-b"]]) {
      await prisma.user.create({
        data: {
          handle: `${PREFIX}-${name}`,
          displayName: name,
          linkedAccounts: { create: { platform: "psn", externalId: `${PREFIX}-${externalId}`, handle: name } },
        },
      });
    }
  });
  afterAll(cleanup);

  const sony = () =>
    fakePsn({
      [`${PREFIX}-acc-a`]: [title("NPWR99001_00", { bronze: 3 }), title("NPWR99002_00", { bronze: 2 })],
      [`${PREFIX}-acc-b`]: [title("NPWR99003_00", { bronze: 2 }), title("NPWR99002_00", { bronze: 2 })],
    });

  it("lists every PSN list whose stored trophies are not Sony's, with Tralked vs Sony", async () => {
    const before = await prisma.achievement.count();
    const report = await auditPsnLists(sony());
    const mine = report.mismatches.filter((m) => m.gameSlug?.startsWith(PREFIX));
    expect(mine.map((m) => m.externalId)).toEqual(["NPWR99001_00", "NPWR99003_00", "NPWR99004_00", "NPWR99005_00"]);
    expect(mine[0]).toMatchObject({
      console: "PS4",
      trophyCount: 4,
      rows: 4,
      stored: { platinum: 1, gold: 1, silver: 1, bronze: 1 },
      sony: { platinum: 0, gold: 0, silver: 0, bronze: 3 },
      foreignIcons: ["NPWR99009_00"],
    });
    expect(mine[2]).toMatchObject({ sony: null, foreignIcons: ["NPWR99008_00"] });
    expect(mine[3]).toMatchObject({ sony: null, trophyCount: 3, rows: 2, foreignIcons: [] });
    expect(report.accounts.filter((a) => a.handle.startsWith(PREFIX))).toEqual([
      { handle: `${PREFIX}-a`, status: "ok", titles: 2 },
      { handle: `${PREFIX}-b`, status: "ok", titles: 2 },
    ]);
    // Read-only.
    expect(await prisma.achievement.count()).toBe(before);
  });

  it("--user: one account's lists only, one title list request", async () => {
    const psn = sony();
    const report = await auditPsnLists(psn, { handle: `${PREFIX}-b` });
    expect(psn.calls).toEqual([`${PREFIX}-acc-b`]);
    expect(report.mismatches.map((m) => m.externalId)).toEqual(["NPWR99003_00"]);
  });

  it("an account Sony does not show is reported, not a mismatch", async () => {
    const report = await auditPsnLists(fakePsn({ [`${PREFIX}-acc-a`]: "private" }), { handle: `${PREFIX}-a` });
    expect(report.accounts).toEqual([{ handle: `${PREFIX}-a`, status: "private", titles: 0 }]);
    expect(report.mismatches).toEqual([]);
  });

  it("a catalog list nobody holds and without rows yet is not a mismatch; a held one still is", async () => {
    const { listProblems } = await import("./psn-audit");
    const ids = ["NPWR99010_00", "NPWR99011_00", "NPWR99012_00"];
    try {
      // 10: catalog, nobody holds it, no rows (as matchPsnCatalog leaves it). 11: catalog, held by
      // a player, no rows. 12: not a catalog list, no rows.
      for (const id of ids) {
        await list(id, [], 5);
        if (id !== "NPWR99012_00") {
          await prisma.psnCatalogList.create({
            data: { id, name: id, console: "PS4", serviceName: "trophy", trophyCount: 5, tiers: { bronze: 5, silver: 0, gold: 0, platinum: 0 } },
          });
        }
      }
      const held = await prisma.trophyList.findUniqueOrThrow({ where: { platform_externalId: { platform: "psn", externalId: "NPWR99011_00" } } });
      const user = await prisma.user.findFirstOrThrow({ where: { handle: `${PREFIX}-a` } });
      await prisma.userTrophyList.create({ data: { userId: user.id, listId: held.id, unlockedCount: 0 } });

      const report = await auditPsnLists(fakePsn({}));
      const flagged = report.mismatches.filter((m) => ids.includes(m.externalId)).map((m) => m.externalId);
      expect(flagged).toEqual(["NPWR99011_00", "NPWR99012_00"]);

      const base = { externalId: "x", gameSlug: null, console: "PS4", trophyCount: 5, stored: { bronze: 0, silver: 0, gold: 0, platinum: 0 }, sony: null, foreignIcons: [] };
      expect(listProblems({ ...base, rows: 0, catalog: true })).toEqual([]);
      expect(listProblems({ ...base, rows: 0 })).toEqual(["trophyCount 5 but 0 rows"]);
      // Once its rows arrive, a catalog list gets every check.
      expect(listProblems({ ...base, rows: 4, catalog: true })).toEqual(["trophyCount 5 but 4 rows"]);
    } finally {
      await prisma.psnCatalogList.deleteMany({ where: { id: { in: ids } } });
    }
  });
});
