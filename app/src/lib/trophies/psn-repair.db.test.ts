import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { xpForAchievement } from "@/lib/engine/xp";
import type { PsnApi, PsnTitle, PsnTrophy } from "@/lib/integrations/psn/types";
import { settleListXp } from "@/lib/progression/list-xp";
import { repairPsnLists } from "./psn-repair";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-b5r` prefix and are removed.
const PREFIX = "test-b5r";
const LIST = "NPWR99510_00";
const LINKED_AT = new Date("2026-01-01T00:00:00Z");
const PAID_AT = new Date("2026-02-01T00:00:00Z");
const NOW = new Date("2026-11-06T12:00:00Z");
const UNLOCKED = new Date("2018-08-20T12:00:00Z");

const sonyIcon = (id: string) => `https://image.api.playstation.com/trophy/np/${LIST}_00BB44/${id}.PNG`;
const crewIcon = (id: string) => `https://image.api.playstation.com/trophy/np/NPWR14350_00_00D207/${id}.PNG`;
const tierXp = (tier: "bronze" | "gold") =>
  xpForPlatformAchievement({ platform: "psn", globalPct: null, points: null, trophyTier: tier, hardcore: false });

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
afterAll(cleanup);

/** Sony's answer for LIST: four bronze trophies 0, 1, 2 and 5. */
function sonyTrophies(over: Partial<PsnTrophy> = {}): PsnTrophy[] {
  return ["0", "1", "2", "5"].map((id) => ({
    trophyId: id,
    name: `Certo ${id}`,
    description: `Descrição ${id}`,
    iconUrl: sonyIcon(id),
    hidden: false,
    tier: "bronze",
    earned: id === "0" || id === "1",
    earnedAt: id === "0" || id === "1" ? UNLOCKED : null,
    rarityPct: 10,
    ...over,
  }));
}

function fakePsn(trophies: () => PsnTrophy[], titles?: PsnTitle[]): PsnApi & { calls: string[] } {
  const calls: string[] = [];
  const title: PsnTitle = {
    npTitleId: LIST,
    serviceName: "trophy",
    name: "Canhões",
    platform: "PS4",
    progress: 50,
    trophyCounts: { bronze: 4, silver: 0, gold: 0, platinum: 0 },
    earnedCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
    lastPlayed: UNLOCKED,
  };
  const unused = () => {
    throw new Error("not used by the repair");
  };
  return {
    calls,
    findProfile: unused,
    getPlayedGames: unused,
    getTrophyListsOfTitles: unused,
    async getTitles(accountId) {
      calls.push(`titles:${accountId}`);
      return titles ?? [title];
    },
    async getTrophies(accountId, npTitleId, serviceName) {
      calls.push(`trophies:${accountId}:${npTitleId}:${serviceName}`);
      return trophies();
    },
  };
}

/**
 * The list as the sync stored it from another list's answer (the Guns, Gore and Cannoli case):
 * five rows with The Crew 2's names, tiers and icons. Row 0 (platinum) has a rarity; row 1 (gold)
 * has none, so its XP comes from its tier. Two holders of rows 0 and 1: `a`, paid under the
 * current link, and `b`, whose entry for row 1 was voided by an unlink before the current link.
 */
async function seed() {
  await cleanup();
  const game = await prisma.game.create({
    data: { slug: `${PREFIX}-ggc`, name: "Canhões", achievementCount: 0, platforms: ["PS4"], skills: { create: [{ skill: "acao" }] } },
  });
  const list = await prisma.trophyList.create({
    data: { gameId: game.id, platform: "psn", externalId: LIST, console: "PS4", name: "Canhões", serviceName: "trophy", trophyCount: 5 },
  });
  const wrong = [
    { apiName: "0", trophyTier: "platinum", globalPct: 80 },
    { apiName: "1", trophyTier: "gold", globalPct: null },
    { apiName: "2", trophyTier: "silver", globalPct: 30 },
    { apiName: "3", trophyTier: "silver", globalPct: null },
    { apiName: "4", trophyTier: "bronze", globalPct: null },
  ];
  const rows = new Map<string, string>();
  for (const w of wrong) {
    const row = await prisma.achievement.create({
      data: { gameId: game.id, platform: "psn", listId: list.id, name: `Errado ${w.apiName}`, iconUrl: crewIcon(w.apiName), namePt: "tradução", ...w },
    });
    rows.set(w.apiName, row.id);
  }
  const holder = async (name: string, linkedAt: Date) =>
    prisma.user.create({
      data: {
        handle: `${PREFIX}-${name}`,
        displayName: name,
        linkedAccounts: { create: { platform: "psn", externalId: `${PREFIX}-acc-${name}`, handle: name, linkedAt } },
      },
    });
  const a = await holder("a", LINKED_AT);
  const b = await holder("b", LINKED_AT);
  for (const u of [a, b]) {
    await prisma.userAchievement.createMany({
      data: ["0", "1"].map((apiName) => ({ userId: u.id, achievementId: rows.get(apiName)!, unlockedAt: UNLOCKED })),
    });
    await prisma.userTrophyList.create({ data: { userId: u.id, listId: list.id, unlockedCount: 2 } });
    await prisma.userGame.create({ data: { userId: u.id, gameId: game.id, platform: "psn", unlockedCount: 2, playtimeMin: 0 } });
    await prisma.$transaction((tx) => settleListXp(tx, u.id, "psn", [game.id], PAID_AT));
  }
  // b unlinked (row 1's entry voided) and linked again later: that XP never comes back.
  const bRelinkedAt = new Date("2026-03-01T00:00:00Z");
  await prisma.xpLedgerEntry.updateMany({
    where: { userId: b.id, sourceKey: rows.get("1")! },
    data: { voidedAt: new Date("2026-02-15T00:00:00Z") },
  });
  await prisma.linkedAccount.updateMany({ where: { userId: b.id }, data: { linkedAt: bRelinkedAt } });
  return { game, list, rows, a, b };
}

const ledgerOf = (userId: string) =>
  prisma.xpLedgerEntry.findMany({ where: { userId }, orderBy: [{ sourceKey: "asc" }], select: { sourceKey: true, xp: true, voidedAt: true } });

describe("repairPsnLists", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    s = await seed();
  });

  it("rebuilds the list from Sony: cosmetic fixes in place, a new row where the XP changes, extra rows removed", async () => {
    const psn = fakePsn(() => sonyTrophies());
    const before = { a: await ledgerOf(s.a.id), b: await ledgerOf(s.b.id) };
    const rarity80 = xpForAchievement(80);
    expect(before.a.filter((e) => !e.voidedAt).map((e) => e.xp).sort()).toEqual([rarity80, tierXp("gold")].sort());

    const [report] = await repairPsnLists(psn, [LIST], { now: NOW });
    expect(report).toMatchObject({
      externalId: LIST,
      status: "repaired",
      rows: { updated: 2, replaced: 1, created: 1, removed: 2 },
      trophyCount: [5, 4],
      warnings: [],
    });
    // Sony was asked through a holder's account, with the list's trophy service.
    expect(psn.calls).toContain(`trophies:${PREFIX}-acc-a:${LIST}:trophy`);

    const rows = await prisma.achievement.findMany({ where: { listId: s.list.id }, orderBy: { apiName: "asc" } });
    expect(rows.map((r) => [r.apiName, r.trophyTier, r.name, r.iconUrl])).toEqual(
      ["0", "1", "2", "5"].map((id) => [id, "bronze", `Certo ${id}`, sonyIcon(id)]),
    );
    const byApi = new Map(rows.map((r) => [r.apiName, r]));
    // In place: same ids; the rarity stays as stored; a translation of the old name is dropped.
    expect(byApi.get("0")!.id).toBe(s.rows.get("0"));
    expect(byApi.get("0")!.globalPct).toBe(80);
    expect(byApi.get("0")!.namePt).toBeNull();
    expect(byApi.get("2")!.id).toBe(s.rows.get("2"));
    // Row 1's XP depended on its tier: a new row (new ledger key); the old one is gone.
    const row1 = byApi.get("1")!;
    expect(row1.id).not.toBe(s.rows.get("1"));
    expect(await prisma.achievement.count({ where: { id: { in: [s.rows.get("1")!, s.rows.get("3")!, s.rows.get("4")!] } } })).toBe(0);
    expect(byApi.get("5")!.globalPct).toBe(10);
    expect((await prisma.trophyList.findUniqueOrThrow({ where: { id: s.list.id } })).trophyCount).toBe(4);

    // The unlocks moved with their dates.
    for (const u of [s.a, s.b]) {
      const unlocks = await prisma.userAchievement.findMany({ where: { userId: u.id }, orderBy: { achievementId: "asc" } });
      expect(unlocks.map((x) => [x.achievementId, x.unlockedAt])).toEqual(
        [byApi.get("0")!.id, row1.id].sort().map((id) => [id, UNLOCKED]),
      );
    }

    // a: row 1's old entry voided by the repair (after the link: the voided-predecessor rule does
    // not block its replacement), and paid again under the new key at the bronze value.
    const a = await ledgerOf(s.a.id);
    expect(a.find((e) => e.sourceKey === s.rows.get("1"))).toMatchObject({ xp: tierXp("gold"), voidedAt: NOW });
    expect(a.find((e) => e.sourceKey === row1.id)).toMatchObject({ xp: tierXp("bronze"), voidedAt: null });
    expect(a.find((e) => e.sourceKey === s.rows.get("0"))).toMatchObject({ xp: rarity80, voidedAt: null });
    // b: the XP voided by the unlink stays voided under the new key too.
    const b = await ledgerOf(s.b.id);
    expect(b.find((e) => e.sourceKey === row1.id)).toMatchObject({ xp: tierXp("bronze"), voidedAt: new Date("2026-02-15T00:00:00Z") });
    expect(b.filter((e) => !e.voidedAt).map((e) => e.sourceKey)).toEqual([s.rows.get("0")]);

    // Before -> after per holder: the wrong platinum is gone, the XP is the rule's.
    const ua = report.users.find((u) => u.handle === `${PREFIX}-a`)!;
    expect(ua).toMatchObject({
      unlocked: [2, 2],
      platinums: [1, 0],
      xp: [rarity80 + tierXp("gold"), rarity80 + tierXp("bronze")],
    });
    expect(report.users.find((u) => u.handle === `${PREFIX}-b`)).toMatchObject({ platinums: [1, 0], xp: [rarity80, rarity80] });
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: s.a.id } });
    expect(stats.totalXp).toBe(rarity80 + tierXp("bronze"));
    const progress = await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId: s.a.id, listId: s.list.id } } });
    expect(progress).toMatchObject({ unlockedCount: 2, completedAt: null });

    // Idempotent: a second run finds nothing to do and pays nothing.
    const again = await repairPsnLists(fakePsn(() => sonyTrophies()), [LIST], { now: new Date(NOW.getTime() + 60_000) });
    expect(again[0]).toMatchObject({ status: "unchanged" });
    expect(await ledgerOf(s.a.id)).toEqual(a);
    expect(await ledgerOf(s.b.id)).toEqual(b);
  });

  it("dry run shows before -> after and writes nothing", async () => {
    const snapshot = async () => ({
      rows: await prisma.achievement.findMany({ where: { gameId: s.game.id }, orderBy: { id: "asc" } }),
      unlocks: await prisma.userAchievement.findMany({ where: { achievement: { gameId: s.game.id } }, orderBy: [{ userId: "asc" }, { achievementId: "asc" }] }),
      ledger: [await ledgerOf(s.a.id), await ledgerOf(s.b.id)],
      list: await prisma.trophyList.findUniqueOrThrow({ where: { id: s.list.id } }),
    });
    const before = await snapshot();
    const [report] = await repairPsnLists(fakePsn(() => sonyTrophies()), [LIST], { now: NOW, dryRun: true });
    expect(report).toMatchObject({ status: "would-repair", rows: { updated: 2, replaced: 1, created: 1, removed: 2 }, trophyCount: [5, 4] });
    expect(report.users.find((u) => u.handle === `${PREFIX}-a`)).toMatchObject({
      platinums: [1, 0],
      xp: [xpForAchievement(80) + tierXp("gold"), xpForAchievement(80) + tierXp("bronze")],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("stops without writing when a row Sony does not have was unlocked", async () => {
    await prisma.userAchievement.create({ data: { userId: s.a.id, achievementId: s.rows.get("3")!, unlockedAt: UNLOCKED } });
    const [report] = await repairPsnLists(fakePsn(() => sonyTrophies()), [LIST], { now: NOW });
    expect(report.status).toBe("blocked");
    expect(report.reason).toMatch(/3.*1 unlock/);
    expect(await prisma.achievement.count({ where: { listId: s.list.id } })).toBe(5);
  });

  it("refuses an answer that is not the list's (another list's icons) and writes nothing", async () => {
    const [report] = await repairPsnLists(fakePsn(() => sonyTrophies({ iconUrl: crewIcon("x") })), [LIST], { now: NOW });
    expect(report.status).toBe("unreadable");
    expect(report.reason).toMatch(/icons of NPWR14350_00/);
    expect((await prisma.trophyList.findUniqueOrThrow({ where: { id: s.list.id } })).trophyCount).toBe(5);
  });

  it("leaves a list whose defined counts are unknown as unreadable, unless forced", async () => {
    // The reading account's title list does not show the list: only the icons could judge Sony's answer.
    const [report] = await repairPsnLists(fakePsn(() => sonyTrophies(), []), [LIST], { now: NOW });
    expect(report.status).toBe("unreadable");
    expect(report.reason).toMatch(/counts .*unknown.*--force/);
    expect((await prisma.trophyList.findUniqueOrThrow({ where: { id: s.list.id } })).trophyCount).toBe(5);
    const [forced] = await repairPsnLists(fakePsn(() => sonyTrophies(), []), [LIST], { now: NOW, force: true });
    expect(forced).toMatchObject({ status: "repaired", trophyCount: [5, 4] });
  });

  it("a completion is sticky: a repair that adds a trophy keeps it and its platinum entry, with a warning", async () => {
    // A second list, correct but missing trophy "2" (a DLC Sony added): holder c completed it.
    const other = "NPWR99511_00";
    const list = await prisma.trophyList.create({
      data: { gameId: s.game.id, platform: "psn", externalId: other, console: "PS5", name: "Canhões PS5", serviceName: "trophy2", trophyCount: 2 },
    });
    const c = await prisma.user.create({
      data: {
        handle: `${PREFIX}-c`,
        displayName: "c",
        linkedAccounts: { create: { platform: "psn", externalId: `${PREFIX}-acc-c`, handle: "c", linkedAt: LINKED_AT } },
      },
    });
    const otherIcon = (id: string) => `https://psnobj.prod.dl.playstation.net/psnobj/${other}/${id}.png`;
    for (const apiName of ["0", "1"]) {
      const row = await prisma.achievement.create({
        data: { gameId: s.game.id, platform: "psn", listId: list.id, apiName, name: `Certo ${apiName}`, description: `Descrição ${apiName}`, iconUrl: otherIcon(apiName), trophyTier: "bronze", globalPct: 50 },
      });
      await prisma.userAchievement.create({ data: { userId: c.id, achievementId: row.id, unlockedAt: UNLOCKED } });
    }
    await prisma.userTrophyList.create({ data: { userId: c.id, listId: list.id, unlockedCount: 2, completedAt: UNLOCKED } });
    await prisma.userGame.create({ data: { userId: c.id, gameId: s.game.id, platform: "psn", unlockedCount: 2, playtimeMin: 0, completedAt: UNLOCKED } });
    await prisma.$transaction((tx) => settleListXp(tx, c.id, "psn", [s.game.id], PAID_AT));
    const platinum = () => prisma.xpLedgerEntry.findMany({ where: { userId: c.id, source: "platinum" }, select: { sourceKey: true, xp: true, voidedAt: true } });
    const paid = await platinum();
    expect(paid).toEqual([expect.objectContaining({ sourceKey: `psn:PS5:${s.game.id}`, voidedAt: null })]);

    const answer = ["0", "1", "2"].map((id) => ({ ...sonyTrophies()[0], trophyId: id, name: `Certo ${id}`, description: `Descrição ${id}`, iconUrl: otherIcon(id), rarityPct: 50 }));
    const title: PsnTitle = {
      npTitleId: other,
      serviceName: "trophy2",
      name: "Canhões PS5",
      platform: "PS5",
      progress: 66,
      trophyCounts: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
      earnedCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
      lastPlayed: UNLOCKED,
    };
    const [report] = await repairPsnLists(fakePsn(() => answer, [title]), [other], { now: NOW });
    expect(report).toMatchObject({ status: "repaired", rows: { updated: 0, replaced: 0, created: 1, removed: 0 }, trophyCount: [2, 3] });
    expect(report.users).toEqual([expect.objectContaining({ handle: `${PREFIX}-c`, unlocked: [2, 2], completed: [true, true] })]);
    // The platinum stays paid as it was (its key did not change; the ledger never rewrites XP), as
    // when the sync sees a DLC: the repair says so.
    expect(report.warnings).toEqual([
      `${PREFIX}-c: completion kept (sticky) at 2/3 trophies: judge it by hand`,
      expect.stringMatching(new RegExp(`^${PREFIX}-c: platinum psn:PS5:${s.game.id} stays paid at ${paid[0].xp} XP`)),
    ]);
    const progress = await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId: c.id, listId: list.id } } });
    expect(progress.completedAt).toEqual(UNLOCKED);
    expect(await platinum()).toEqual(paid);
  });

  it("a completion whose unlocks have no date is dated now, not the epoch", async () => {
    // Unreachable for PSN in practice (platform-user stores seenAt), but the fallback must be sane.
    await prisma.userAchievement.updateMany({ where: { userId: s.a.id }, data: { unlockedAt: null } });
    const two = sonyTrophies().slice(0, 2);
    const title: PsnTitle = {
      npTitleId: LIST,
      serviceName: "trophy",
      name: "Canhões",
      platform: "PS4",
      progress: 100,
      trophyCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
      earnedCounts: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
      lastPlayed: UNLOCKED,
    };
    const [report] = await repairPsnLists(fakePsn(() => two, [title]), [LIST], { now: NOW });
    expect(report.status).toBe("repaired");
    const progress = await prisma.userTrophyList.findUniqueOrThrow({ where: { userId_listId: { userId: s.a.id, listId: s.list.id } } });
    expect(progress.completedAt).toEqual(NOW);
  });

  it("reports a list it does not know", async () => {
    const [report] = await repairPsnLists(fakePsn(() => sonyTrophies()), ["NPWR00000_00"], { now: NOW });
    expect(report.status).toBe("not-found");
  });
});
