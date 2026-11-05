import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { unlink } from "@/lib/accounts/link";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { rebuildListXp, settleListXp } from "./list-xp";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-lxp` prefix and are removed.
const PREFIX = "test-lxp";
const STEAM_APP_ID = 97300001;
const NOW = new Date("2026-11-05T12:00:00Z");
const T0 = new Date("2026-10-20T12:00:00Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

let counter = 0;

async function cleanup() {
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(cleanup);
afterAll(cleanup);

async function newUser() {
  counter++;
  return prisma.user.create({ data: { handle: `${PREFIX}-${counter}`, displayName: "Teste" } });
}

async function newGame(extra: { steamAppId?: number } = {}) {
  counter++;
  return prisma.game.create({
    data: {
      slug: `${PREFIX}-${counter}`,
      name: `Jogo ${counter}`,
      achievementCount: 0,
      platforms: ["PS5"],
      skills: { create: [{ skill: "rpg" }] },
      ...extra,
    },
  });
}

async function newList(gameId: string, console: string | null, createdAt: Date, platform = "psn") {
  counter++;
  return prisma.trophyList.create({
    data: { gameId, platform, externalId: `${PREFIX}-L${counter}`, console, name: "Lista", createdAt },
  });
}

/** Trophies "0" (platinum) and "1" (bronze) of a list (or list-less rows with listId null). */
async function newTrophies(gameId: string, listId: string | null, apiNames = ["0", "1"]) {
  const rows = [];
  for (const apiName of apiNames) {
    rows.push(
      await prisma.achievement.create({
        data: {
          gameId,
          platform: "psn",
          listId,
          apiName,
          name: `T${apiName}`,
          trophyTier: apiName === "0" ? "platinum" : "bronze",
        },
      }),
    );
  }
  return rows;
}

const tierXp = (tier: string) =>
  xpForPlatformAchievement({ platform: "psn", globalPct: null, points: null, trophyTier: tier as "bronze", hardcore: false });

const settle = (userId: string, gameIds: string[], now = NOW) =>
  prisma.$transaction((tx) => settleListXp(tx, userId, "psn", gameIds, now));

const valid = (userId: string) =>
  prisma.xpLedgerEntry.findMany({ where: { userId, voidedAt: null }, orderBy: { sourceKey: "asc" } });

describe("settleListXp", () => {
  it("legacy psn:<gameId> platinum is voided and replaced by psn:PS5:<gameId> with the same xp", async () => {
    const user = await newUser();
    const game = await newGame();
    const list = await newList(game.id, "PS5", T0);
    const trophies = await newTrophies(game.id, list.id);
    await prisma.userAchievement.createMany({
      data: trophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(i) })),
    });
    await prisma.userTrophyList.create({
      data: { userId: user.id, listId: list.id, unlockedCount: 2, completedAt: at(1) },
    });
    const legacyXp = platinumBonus([tierXp("platinum"), tierXp("bronze")]);
    await prisma.xpLedgerEntry.createMany({
      data: [
        ...trophies.map((t, i) => ({
          userId: user.id,
          source: "achievement",
          sourceKey: t.id,
          platform: "psn",
          xp: tierXp(t.trophyTier ?? "bronze"),
          skills: ["rpg"],
          createdAt: at(i),
        })),
        { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}`, platform: "psn", xp: legacyXp, skills: ["rpg"], createdAt: at(1) },
      ],
    });

    expect(await settle(user.id, [game.id])).toEqual({ paid: 1, voided: 1 });

    const legacy = await prisma.xpLedgerEntry.findUniqueOrThrow({
      where: { userId_source_sourceKey: { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}` } },
    });
    expect(legacy.voidedAt).toEqual(NOW);
    const replaced = await prisma.xpLedgerEntry.findUniqueOrThrow({
      where: { userId_source_sourceKey: { userId: user.id, source: "platinum", sourceKey: `psn:PS5:${game.id}` } },
    });
    expect(replaced).toMatchObject({ xp: legacyXp, platform: "psn", createdAt: at(1), skills: ["rpg"], voidedAt: null });
    // The trophies were already keyed right: untouched.
    expect((await valid(user.id)).filter((e) => e.source === "achievement")).toHaveLength(2);
    expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });
  });

  it("a voided key is never paid again after relink", async () => {
    const user = await newUser();
    const externalId = `${PREFIX}-acc-${counter}`;
    const account = await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId, handle: "Teste", linkedAt: T0 },
    });
    const game = await newGame();
    const eu = await newList(game.id, "PS5", T0);
    const jp = await newList(game.id, "PS5", at(1));
    const euTrophies = await newTrophies(game.id, eu.id);
    const jpTrophies = await newTrophies(game.id, jp.id);

    // First link: the EU list, complete.
    await prisma.userAchievement.createMany({
      data: euTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
    });
    await prisma.userTrophyList.create({
      data: { userId: user.id, listId: eu.id, unlockedCount: 2, completedAt: at(11) },
    });
    expect(await settle(user.id, [game.id], at(20))).toEqual({ paid: 3, voided: 0 });

    // Unlink: the entries are voided and the unlocks removed (lib/accounts/link.ts releaseAccount).
    expect(await unlink(user.id, "psn", at(30))).toBe(true);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(0);
    expect(await valid(user.id)).toHaveLength(0);

    // Relink the same account; the sync finds the EU unlocks again and the JP list too (same trophies).
    await prisma.linkedAccount.update({ where: { id: account.id }, data: { externalId, linkedAt: at(40) } });
    await prisma.userAchievement.createMany({
      data: [
        ...euTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
        ...jpTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(5 + i) })),
      ],
    });
    await prisma.userTrophyList.upsert({
      where: { userId_listId: { userId: user.id, listId: eu.id } },
      create: { userId: user.id, listId: eu.id, unlockedCount: 2, completedAt: at(11) },
      update: { completedAt: at(11) },
    });
    await prisma.userTrophyList.create({
      data: { userId: user.id, listId: jp.id, unlockedCount: 2, completedAt: at(6) },
    });

    expect(await settle(user.id, [game.id], at(50))).toEqual({ paid: 0, voided: 0 });
    expect(await valid(user.id)).toHaveLength(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(3);
  });

  /**
   * Pre-version ledger of a PS5 game with an EU (canonical) and a JP list: the player earned the JP
   * list, paid under the old keys (own JP ids, legacy `psn:<gameId>` platinum).
   */
  async function preVersionPlayer() {
    const user = await newUser();
    const externalId = `${PREFIX}-acc-${counter}`;
    const account = await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId, handle: "Teste", linkedAt: T0 },
    });
    const game = await newGame();
    const eu = await newList(game.id, "PS5", T0);
    const jp = await newList(game.id, "PS5", at(1));
    const euTrophies = await newTrophies(game.id, eu.id);
    const jpTrophies = await newTrophies(game.id, jp.id);
    const imported = async () => {
      await prisma.userAchievement.createMany({
        data: jpTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
      });
      await prisma.userTrophyList.upsert({
        where: { userId_listId: { userId: user.id, listId: jp.id } },
        create: { userId: user.id, listId: jp.id, unlockedCount: 2, completedAt: at(11) },
        update: { completedAt: at(11) },
      });
      await prisma.userGame.upsert({
        where: { userId_gameId_platform: { userId: user.id, gameId: game.id, platform: "psn" } },
        create: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 0, unlockedCount: 2, completedAt: at(11) },
        update: { completedAt: at(11) },
      });
    };
    await imported();
    await prisma.xpLedgerEntry.createMany({
      data: [
        ...jpTrophies.map((t, i) => ({
          userId: user.id,
          source: "achievement",
          sourceKey: t.id,
          platform: "psn",
          xp: tierXp(t.trophyTier ?? "bronze"),
          skills: ["rpg"],
          createdAt: at(10 + i),
        })),
        { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}`, platform: "psn", xp: 99, skills: ["rpg"], createdAt: at(11) },
      ],
    });
    return { user, account, externalId, game, euTrophies, jpTrophies, imported };
  }

  it("valid legacy keys are replaced by the version keys", async () => {
    const { user, game, euTrophies } = await preVersionPlayer();
    expect(await rebuildListXp(user.id, NOW)).toEqual({ paid: 3, voided: 3 });
    expect((await valid(user.id)).map((e) => e.sourceKey).sort()).toEqual(
      [...euTrophies.map((t) => t.id), `psn:PS5:${game.id}`].sort(),
    );
  });

  it("a legacy key voided by unlink is not paid under the version key after relink/rebuild", async () => {
    const { user, account, externalId, imported } = await preVersionPlayer();
    expect(await unlink(user.id, "psn", at(30))).toBe(true);
    expect(await valid(user.id)).toHaveLength(0);

    // Relink; the sync imports the JP list again, now under the version rule.
    await prisma.linkedAccount.update({ where: { id: account.id }, data: { externalId, linkedAt: at(40) } });
    await imported();
    // Neither the trophies (canonical EU keys; their JP own-id entries are voided) nor the PS5
    // platinum (the legacy psn:<gameId> is voided) is paid again.
    expect(await rebuildListXp(user.id, NOW)).toEqual({ paid: 0, voided: 0 });
    expect(await valid(user.id)).toHaveLength(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(3);
  });

  it("a legacy platinum voided by a settle under the current link does not block a later version platinum", async () => {
    // Multi-list legacy game: the PS3 list is read first (incomplete), which voids the legacy
    // platinum; the PS4 list read later is complete and its version platinum is paid.
    const user = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId: `${PREFIX}-acc-${counter}`, handle: "Teste", linkedAt: T0 },
    });
    const game = await newGame();
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}`, platform: "psn", xp: 99, skills: ["rpg"], createdAt: at(1) },
    });
    const ps3 = await newList(game.id, "PS3", at(2));
    const ps3Trophies = await newTrophies(game.id, ps3.id);
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: ps3Trophies[1].id, unlockedAt: at(3) } });
    await prisma.userTrophyList.create({ data: { userId: user.id, listId: ps3.id, unlockedCount: 1 } });
    await settle(user.id, [game.id], at(20));
    expect((await valid(user.id)).filter((e) => e.source === "platinum")).toEqual([]);

    const ps4 = await newList(game.id, "PS4", at(21));
    const ps4Trophies = await newTrophies(game.id, ps4.id);
    await prisma.userAchievement.createMany({
      data: ps4Trophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(22 + i) })),
    });
    await prisma.userTrophyList.create({ data: { userId: user.id, listId: ps4.id, unlockedCount: 2, completedAt: at(23) } });
    await settle(user.id, [game.id], at(30));
    expect((await valid(user.id)).filter((e) => e.source === "platinum").map((e) => e.sourceKey)).toEqual([
      `psn:PS4:${game.id}`,
    ]);
  });

  it("once the game has a list, entries of list-less rows are voided and the list pays", async () => {
    const user = await newUser();
    const game = await newGame();
    // Rows written before the game had lists (still waiting for the migration's cleanup).
    const old = await newTrophies(game.id, null, ["0"]);
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: old[0].id, unlockedAt: at(0) } });
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: old[0].id, platform: "psn", xp: 300, skills: ["rpg"], createdAt: at(0) },
    });
    expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });

    const list = await newList(game.id, "PS5", at(5));
    const trophies = await newTrophies(game.id, list.id, ["0"]);
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: trophies[0].id, unlockedAt: at(0) } });
    expect(await settle(user.id, [game.id])).toEqual({ paid: 1, voided: 1 });
    expect((await valid(user.id)).map((e) => e.sourceKey)).toEqual([trophies[0].id]);
  });
});

describe("rebuildListXp", () => {
  /** A player with Steam XP and a PSN game whose ledger still has the legacy platinum key. */
  async function playerWithSteamAndPsn() {
    const user = await newUser();
    const steamGame = await newGame({ steamAppId: STEAM_APP_ID + counter });
    const steamAchievement = await prisma.achievement.create({
      data: { gameId: steamGame.id, platform: "steam", apiName: "S1", name: "S1", globalPct: 5 },
    });
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: steamAchievement.id, unlockedAt: at(0) } });
    await prisma.userGame.create({
      data: { userId: user.id, gameId: steamGame.id, platform: "steam", playtimeMin: 60, unlockedCount: 1, completedAt: at(0) },
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        { userId: user.id, source: "achievement", sourceKey: steamAchievement.id, xp: xpForAchievement(5), skills: ["rpg"], createdAt: at(0) },
        { userId: user.id, source: "platinum", sourceKey: steamGame.id, xp: 100, skills: ["rpg"], createdAt: at(0) },
        // A voided Steam entry stays as it is too.
        { userId: user.id, source: "achievement", sourceKey: `${PREFIX}-gone-${counter}`, xp: 10, skills: [], voidedAt: T0 },
      ],
    });

    const game = await newGame();
    const list = await newList(game.id, "PS5", T0);
    const trophies = await newTrophies(game.id, list.id);
    await prisma.userAchievement.createMany({
      data: trophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(i) })),
    });
    await prisma.userTrophyList.create({ data: { userId: user.id, listId: list.id, unlockedCount: 2, completedAt: at(1) } });
    await prisma.userGame.create({
      data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 0, unlockedCount: 2, completedAt: at(1) },
    });
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}`, platform: "psn", xp: 77, skills: ["rpg"], createdAt: at(1) },
    });
    return { user, game };
  }

  const steamRows = (userId: string) =>
    prisma.xpLedgerEntry.findMany({ where: { userId, platform: null }, orderBy: { id: "asc" } });

  it("Steam ledger rows are never touched", async () => {
    const { user } = await playerWithSteamAndPsn();
    const before = await steamRows(user.id);
    expect(before).toHaveLength(3);
    const result = await rebuildListXp(user.id, NOW);
    expect(result).toEqual({ paid: 3, voided: 1 }); // 2 trophies + psn:PS5 platinum; legacy platinum voided
    expect(await steamRows(user.id)).toEqual(before);
  });

  it("rebuildListXp twice changes nothing the second time", async () => {
    const { user, game } = await playerWithSteamAndPsn();
    await rebuildListXp(user.id, NOW);
    const ledger = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
    const stats = await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } });
    expect(await rebuildListXp(user.id, new Date(NOW.getTime() + MIN))).toEqual({ paid: 0, voided: 0 });
    expect(await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(ledger);
    expect((await prisma.userStats.findUniqueOrThrow({ where: { userId: user.id } })).totalXp).toBe(stats.totalXp);
    // The replacement is valued like the sync values a platinum: over the list's trophies.
    const platinum = ledger.find((e) => e.sourceKey === `psn:PS5:${game.id}`);
    expect(platinum).toMatchObject({ xp: platinumBonus([tierXp("platinum"), tierXp("bronze")]), voidedAt: null });
    expect(ledger.find((e) => e.sourceKey === `psn:${game.id}`)?.voidedAt).toEqual(NOW);
  });
});
