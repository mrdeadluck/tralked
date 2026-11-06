import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { levelFromXp, platinumBonus } from "@/lib/engine/xp";
import { regionalListXp } from "./regional-xp";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-rxp` prefix and are removed;
// every run is scoped to one fixture user (--user).
const PREFIX = "test-rxp";
const T0 = new Date("2026-10-20T12:00:00Z");
const NOW = new Date("2026-11-06T12:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
let counter = 0;

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}
beforeAll(cleanup);
afterAll(cleanup);

const tierXp = (tier: string) =>
  xpForPlatformAchievement({ platform: "psn", globalPct: null, points: null, trophyTier: tier as "bronze", hardcore: false });

async function newList(gameId: string, console: string, createdAt: Date) {
  counter++;
  const list = await prisma.trophyList.create({
    data: { gameId, platform: "psn", externalId: `${PREFIX}-L${counter}`, console, name: "Lista", createdAt },
  });
  const trophies = await prisma.achievement.createManyAndReturn({
    data: ["0", "1"].map((apiName) => ({
      gameId,
      platform: "psn",
      listId: list.id,
      apiName,
      name: `T${apiName}`,
      trophyTier: apiName === "0" ? "platinum" : "bronze",
    })),
  });
  return { list, trophies: trophies.sort((a, b) => a.apiName.localeCompare(b.apiName)) };
}

/**
 * A player who earned both regional PS5 lists of a game (EU canonical, JP) and a single-list PS4
 * game, with the ledger the rule before every list counted paid: EU trophies + psn:PS5 platinum.
 */
async function player() {
  counter++;
  const user = await prisma.user.create({ data: { handle: `${PREFIX}-${counter}`, displayName: "Teste" } });
  const game = await prisma.game.create({
    data: { slug: `${PREFIX}-g${counter}`, name: "Jogo", achievementCount: 0, platforms: ["PS5"], skills: { create: [{ skill: "rpg" }] } },
  });
  const eu = await newList(game.id, "PS5", T0);
  const jp = await newList(game.id, "PS5", at(1));
  const single = await prisma.game.create({
    data: { slug: `${PREFIX}-s${counter}`, name: "Sozinho", achievementCount: 0, platforms: ["PS4"] },
  });
  const ps4 = await newList(single.id, "PS4", T0);
  const lists = [eu, jp, ps4];
  for (const [k, l] of lists.entries()) {
    await prisma.userAchievement.createMany({
      data: l.trophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 * (k + 1) + i) })),
    });
    await prisma.userTrophyList.create({
      data: { userId: user.id, listId: l.list.id, unlockedCount: 2, completedAt: at(10 * (k + 1) + 1) },
    });
  }
  const paid = (l: typeof eu, k: number) =>
    l.trophies.map((t, i) => ({
      userId: user.id,
      source: "achievement",
      sourceKey: t.id,
      platform: "psn",
      xp: tierXp(t.trophyTier!),
      skills: ["rpg"],
      createdAt: at(10 * (k + 1) + i),
    }));
  const bonus = platinumBonus([tierXp("platinum"), tierXp("bronze")]);
  await prisma.xpLedgerEntry.createMany({
    data: [
      ...paid(eu, 0),
      ...paid(ps4, 2),
      { userId: user.id, source: "platinum", sourceKey: `psn:PS5:${game.id}`, platform: "psn", xp: bonus, skills: ["rpg"], createdAt: at(11) },
      { userId: user.id, source: "platinum", sourceKey: `psn:PS4:${single.id}`, platform: "psn", xp: bonus, skills: ["rpg"], createdAt: at(31) },
    ],
  });
  const totalXp = 2 * (tierXp("platinum") + tierXp("bronze")) + 2 * bonus;
  await prisma.userStats.create({ data: { userId: user.id, totalXp, level: levelFromXp(totalXp).level, vocation: "Recruta" } });
  return { user, game, eu, jp, bonus, totalXp };
}

const ledger = (userId: string) => prisma.xpLedgerEntry.findMany({ where: { userId }, orderBy: { id: "asc" } });

describe("regionalListXp (pnpm trophy-lists:regional-xp)", () => {
  it("--dry-run writes nothing and reports what the run would pay", async () => {
    const { user, totalXp, bonus } = await player();
    const before = await ledger(user.id);
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });

    const [report] = await regionalListXp({ dryRun: true, handle: user.handle, now: NOW });

    expect(await ledger(user.id)).toEqual(before);
    expect(await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } })).toEqual(stats);
    const added = tierXp("platinum") + tierXp("bronze") + bonus;
    expect(report).toMatchObject({
      handle: user.handle,
      games: 1,
      created: { trophies: 2, platinums: 1 },
      voided: 0,
      // Every unlock (EU and JP) and every complete list of the game paid once.
      paid: { trophies: [4, 4], platinums: [2, 2] },
      unpaid: { voidedUnderLink: 0, voidedBeforeLink: 0, blocked: 0 },
      xp: [totalXp, totalXp + added],
      level: [levelFromXp(totalXp).level, levelFromXp(totalXp + added).level],
      // Before: one per version (PS5, PS4); after: one per list (EU, JP, PS4).
      platinums: [2, 3],
      psnPlatinums: 3,
    });
  });

  it("pays the missing per-list entries once: a second run pays nothing", async () => {
    const { user, game, jp, totalXp, bonus } = await player();
    const before = await ledger(user.id);
    const [dry] = await regionalListXp({ dryRun: true, handle: user.handle, now: NOW });

    const [report] = await regionalListXp({ dryRun: false, handle: user.handle, now: NOW });
    expect(report).toEqual(dry);

    const after = await ledger(user.id);
    // Nothing paid before is voided or rewritten.
    expect(after.filter((e) => before.some((b) => b.id === e.id))).toEqual(before);
    expect(after.filter((e) => !before.some((b) => b.id === e.id)).map((e) => e.sourceKey).sort()).toEqual(
      [...jp.trophies.map((t) => t.id), `psn:${jp.list.externalId}:${game.id}`].sort(),
    );
    const added = tierXp("platinum") + tierXp("bronze") + bonus;
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } })).totalXp).toBe(totalXp + added);

    const [again] = await regionalListXp({ dryRun: false, handle: user.handle, now: new Date(NOW.getTime() + 60_000) });
    expect(again).toMatchObject({
      created: { trophies: 0, platinums: 0 },
      voided: 0,
      paid: { trophies: [4, 4], platinums: [2, 2] },
      xp: [totalXp + added, totalXp + added],
    });
    expect(await ledger(user.id)).toEqual(after);
  });

  /** The player's JP trophy "1" paid by own id, then voided at `voidedAt`; the PSN link made at `linkedAt`. */
  async function voidedJpEntry(linkedAt: Date, voidedAt: Date) {
    const p = await player();
    await prisma.linkedAccount.create({
      data: { userId: p.user.id, platform: "psn", externalId: `${PREFIX}-acc-${counter}`, handle: "Teste", linkedAt },
    });
    const entry = await prisma.xpLedgerEntry.create({
      data: {
        userId: p.user.id,
        source: "achievement",
        sourceKey: p.jp.trophies[1].id,
        platform: "psn",
        xp: tierXp("bronze"),
        skills: ["rpg"],
        createdAt: at(21),
        voidedAt,
      },
    });
    return { ...p, entry };
  }

  it("restores, once, a JP own-id entry the old rule voided under the current link (merged into the canonical key)", async () => {
    // Production case (phase a finish, 2026-11-05 21h UTC): the JP list was read first and its
    // trophies paid by own id; the EU rows came later and the old rule moved them to the EU keys.
    const { user, game, jp, entry, totalXp, bonus } = await voidedJpEntry(T0, at(60));
    const lines: string[] = [];
    const [dry] = await regionalListXp({ dryRun: true, handle: user.handle, now: NOW, log: (l) => lines.push(l) });
    expect(dry).toMatchObject({
      // JP "0" and the JP platinum created, JP "1" restored.
      created: { trophies: 1, platinums: 1 },
      restored: 1,
      entries: {
        created: [`achievement:${jp.trophies[0].id}`, `platinum:psn:${jp.list.externalId}:${game.id}`].sort(),
        restored: [{ id: entry.id, source: "achievement", sourceKey: jp.trophies[1].id, voidedAt: at(60).toISOString() }],
      },
      voided: 0,
      unpaid: { voidedUnderLink: 0, voidedBeforeLink: 0, blocked: 0 },
      paid: { trophies: [4, 4], platinums: [2, 2] },
    });
    expect(await prisma.xpLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ voidedAt: at(60) });
    // The restored entries are logged by the hour they were voided.
    expect(lines).toContain(`  ${user.handle}: 1 entries voided at ${at(60).toISOString().slice(0, 13)}h (${tierXp("bronze").toLocaleString("pt-BR")} XP), restored`);

    const [report] = await regionalListXp({ dryRun: false, handle: user.handle, now: NOW });
    expect(report).toEqual(dry);
    // Restored as it was paid (value and date kept).
    expect(await prisma.xpLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).toEqual({ ...entry, voidedAt: null });
    const added = tierXp("platinum") + tierXp("bronze") + bonus;
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } })).totalXp).toBe(totalXp + added);

    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
    const [again] = await regionalListXp({ dryRun: false, handle: user.handle, now: new Date(NOW.getTime() + 60_000) });
    expect(again).toMatchObject({ created: { trophies: 0, platinums: 0 }, restored: 0, voided: 0, xp: [totalXp + added, totalXp + added] });
    expect(await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(ledger);
  });

  it("never restores an entry voided by an unlink (voided before the current link)", async () => {
    const { user, entry } = await voidedJpEntry(at(100), at(60));
    const [report] = await regionalListXp({ dryRun: false, handle: user.handle, now: NOW });
    expect(report).toMatchObject({
      unpaid: { voidedUnderLink: 0, voidedBeforeLink: 1, blocked: 0 },
      paid: { trophies: [3, 4], platinums: [2, 2] },
    });
    expect(await prisma.xpLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ voidedAt: at(60) });
  });
});
