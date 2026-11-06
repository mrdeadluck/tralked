import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { unlink } from "@/lib/accounts/link";
import { xpForPlatformAchievement } from "@/lib/engine/trophies";
import { platinumBonus, xpForAchievement } from "@/lib/engine/xp";
import { rebuildListXp, settleListXp } from "./list-xp";
import { voidFraudEntries } from "./recompute";

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

  it("a key voided by an unlink is never paid again; the never-paid regional list is paid once after relink", async () => {
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

    // The unlink forfeited what it voided: the EU trophies and the EU platinum stay voided. The JP
    // list was never paid: its trophies and platinum are paid once.
    expect(await settle(user.id, [game.id], at(50))).toEqual({ paid: 3, voided: 0 });
    expect((await valid(user.id)).map((e) => e.sourceKey).sort()).toEqual(
      [...jpTrophies.map((t) => t.id), `psn:${jp.externalId}:${game.id}`].sort(),
    );
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, voidedAt: { not: null } } })).toBe(3);
    expect(await settle(user.id, [game.id], at(51))).toEqual({ paid: 0, voided: 0 });
  });

  /**
   * A PS5 game with an EU (canonical) and a JP list, both earned, paid by the rule before every list
   * counted: the trophies once, under the canonical EU ids, and one platinum under psn:PS5.
   */
  async function paidOncePerVersion() {
    const user = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId: `${PREFIX}-acc-${counter}`, handle: "Teste", linkedAt: T0 },
    });
    const game = await newGame();
    const eu = await newList(game.id, "PS5", T0);
    const jp = await newList(game.id, "PS5", at(1));
    const euTrophies = await newTrophies(game.id, eu.id);
    const jpTrophies = await newTrophies(game.id, jp.id);
    await prisma.userAchievement.createMany({
      data: [
        ...euTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
        ...jpTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(20 + i) })),
      ],
    });
    await prisma.userTrophyList.createMany({
      data: [
        { userId: user.id, listId: eu.id, unlockedCount: 2, completedAt: at(11) },
        { userId: user.id, listId: jp.id, unlockedCount: 2, completedAt: at(21) },
      ],
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        // Values unlike what the rule gives now: an existing entry is never rewritten.
        ...euTrophies.map((t, i) => ({
          userId: user.id,
          source: "achievement",
          sourceKey: t.id,
          platform: "psn",
          xp: 7,
          skills: ["rpg"],
          createdAt: at(10 + i),
        })),
        { userId: user.id, source: "platinum", sourceKey: `psn:PS5:${game.id}`, platform: "psn", xp: 99, skills: ["rpg"], createdAt: at(11) },
      ],
    });
    return { user, game, eu, jp, euTrophies, jpTrophies };
  }

  it("every regional list pays: the entries already paid stay as they are, the JP list gets its own", async () => {
    const { user, game, jp, euTrophies, jpTrophies } = await paidOncePerVersion();
    const before = await valid(user.id);

    expect(await settle(user.id, [game.id])).toEqual({ paid: 3, voided: 0 });

    const after = await valid(user.id);
    // Nothing paid before is voided or rewritten.
    expect(after.filter((e) => before.some((b) => b.id === e.id))).toEqual(before);
    const added = after.filter((e) => !before.some((b) => b.id === e.id));
    expect(added.map((e) => [e.source, e.sourceKey, e.xp, e.createdAt]).sort()).toEqual(
      [
        ["achievement", jpTrophies[0].id, tierXp("platinum"), at(20)],
        ["achievement", jpTrophies[1].id, tierXp("bronze"), at(21)],
        ["platinum", `psn:${jp.externalId}:${game.id}`, platinumBonus([tierXp("platinum"), tierXp("bronze")]), at(21)],
      ].sort(),
    );
    // The EU trophies keep their canonical keys (their own ids), paid once.
    expect(after.filter((e) => euTrophies.some((t) => t.id === e.sourceKey))).toHaveLength(2);
    expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });
  });

  it("an entry paid under the canonical key for another list's unlock keeps paying it (no void, no second payment)", async () => {
    // The player earned only the JP list; the old rule paid its trophies under the canonical EU ids
    // and the platinum under psn:PS5.
    const user = await newUser();
    const game = await newGame();
    const eu = await newList(game.id, "PS5", T0);
    const jp = await newList(game.id, "PS5", at(1));
    const euTrophies = await newTrophies(game.id, eu.id);
    const jpTrophies = await newTrophies(game.id, jp.id);
    await prisma.userAchievement.createMany({
      data: jpTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
    });
    await prisma.userTrophyList.create({ data: { userId: user.id, listId: jp.id, unlockedCount: 2, completedAt: at(11) } });
    await prisma.xpLedgerEntry.createMany({
      data: [
        ...euTrophies.map((t, i) => ({
          userId: user.id,
          source: "achievement",
          sourceKey: t.id,
          platform: "psn",
          xp: tierXp(t.trophyTier ?? "bronze"),
          skills: ["rpg"],
          createdAt: at(10 + i),
        })),
        { userId: user.id, source: "platinum", sourceKey: `psn:PS5:${game.id}`, platform: "psn", xp: 99, skills: ["rpg"], createdAt: at(11) },
      ],
    });
    const before = await valid(user.id);
    expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });
    expect(await valid(user.id)).toEqual(before);

    // The player earns the EU list later: the canonical keys now speak for it, JP gets its own.
    await prisma.userAchievement.createMany({
      data: euTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(30 + i) })),
    });
    await prisma.userTrophyList.create({ data: { userId: user.id, listId: eu.id, unlockedCount: 2, completedAt: at(31) } });
    expect(await settle(user.id, [game.id])).toEqual({ paid: 3, voided: 0 });
    expect((await valid(user.id)).map((e) => e.sourceKey).sort()).toEqual(
      [...euTrophies.map((t) => t.id), ...jpTrophies.map((t) => t.id), `psn:PS5:${game.id}`, `psn:${jp.externalId}:${game.id}`].sort(),
    );
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

  it("the legacy platinum is replaced by the version key; JP trophies paid by own id keep their keys", async () => {
    const { user, game, jpTrophies } = await preVersionPlayer();
    // A copy already paid under its own id is never moved to the canonical key (no void, no new row).
    expect(await rebuildListXp(user.id, NOW)).toEqual({ paid: 1, voided: 1 });
    expect((await valid(user.id)).map((e) => e.sourceKey).sort()).toEqual(
      [...jpTrophies.map((t) => t.id), `psn:PS5:${game.id}`].sort(),
    );
    expect(await rebuildListXp(user.id, NOW)).toEqual({ paid: 0, voided: 0 });
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

  it("a legacy platinum voided by an unlink blocks only the earliest list platinum after relink", async () => {
    // The collapsed game paid one platinum (legacy key, its earliest completion). Unlinked, then
    // relinked: the PS4 (earliest) platinum stays forfeited, the PS5 one was never paid and is.
    const user = await newUser();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "psn", externalId: `${PREFIX}-acc-${counter}`, handle: "Teste", linkedAt: at(40) },
    });
    const game = await newGame();
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "platinum", sourceKey: `psn:${game.id}`, platform: "psn", xp: 99, skills: ["rpg"], createdAt: at(11), voidedAt: at(30) },
    });
    for (const [k, console] of ["PS4", "PS5"].entries()) {
      const list = await newList(game.id, console, at(k));
      const trophies = await newTrophies(game.id, list.id);
      await prisma.userAchievement.createMany({
        data: trophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + 10 * k + i) })),
      });
      await prisma.userTrophyList.create({ data: { userId: user.id, listId: list.id, unlockedCount: 2, completedAt: at(11 + 10 * k) } });
    }
    await settle(user.id, [game.id], at(50));
    expect((await valid(user.id)).filter((e) => e.source === "platinum").map((e) => e.sourceKey)).toEqual([`psn:PS5:${game.id}`]);
    expect(await settle(user.id, [game.id], at(51))).toEqual({ paid: 0, voided: 0 });
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

  it("a list-less unlock covered by a list row is voided, an uncovered one stays paid", async () => {
    const user = await newUser();
    const game = await newGame();
    // A multi-list game after the backfill: the old list-less rows hold the unlocks; the PS5 list
    // was read once (it holds "1" valid and "2" suspicious), the PS4 one never.
    await newList(game.id, "PS4", T0);
    const ps5 = await newList(game.id, "PS5", at(1));
    const old = await newTrophies(game.id, null, ["0", "1", "2"]);
    await prisma.userAchievement.createMany({
      data: old.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(i) })),
    });
    await prisma.xpLedgerEntry.createMany({
      data: old.map((t, i) => ({
        userId: user.id,
        source: "achievement",
        sourceKey: t.id,
        platform: "psn",
        xp: tierXp(t.trophyTier ?? "bronze"),
        skills: ["rpg"],
        createdAt: at(i),
      })),
    });
    const [ps5One, ps5Two] = await newTrophies(game.id, ps5.id, ["1", "2"]);
    await prisma.userAchievement.createMany({
      data: [
        { userId: user.id, achievementId: ps5One.id, unlockedAt: at(1) },
        { userId: user.id, achievementId: ps5Two.id, unlockedAt: at(2), suspicious: true },
      ],
    });
    await prisma.userTrophyList.create({ data: { userId: user.id, listId: ps5.id, unlockedCount: 2 } });

    // "1" moves to the list row's key; "0" (no list row) and "2" (only a suspicious copy) stay paid.
    expect(await settle(user.id, [game.id])).toEqual({ paid: 1, voided: 1 });
    expect((await valid(user.id)).map((e) => e.sourceKey).sort()).toEqual([old[0].id, old[2].id, ps5One.id].sort());
    expect(
      (await prisma.xpLedgerEntry.findUniqueOrThrow({
        where: { userId_source_sourceKey: { userId: user.id, source: "achievement", sourceKey: old[1].id } },
      })).voidedAt,
    ).toEqual(NOW);
    expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });
  });
  it("a copy paid under its own id is never moved or voided when the canonical rows arrive later", async () => {
    // The EU list (older: canonical) had no rows when the JP list was read: JP paid by own id.
    const user = await newUser();
    const game = await newGame();
    const eu = await newList(game.id, "PS5", T0);
    const jp = await newList(game.id, "PS5", at(1));
    const jpTrophies = await newTrophies(game.id, jp.id);
    await prisma.userAchievement.createMany({
      data: jpTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
    });
    expect(await settle(user.id, [game.id])).toEqual({ paid: 2, voided: 0 });
    const before = await valid(user.id);

    // Another player's sync writes the EU rows; this player never earned the EU list.
    await newTrophies(game.id, eu.id);
    expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });
    expect(await valid(user.id)).toEqual(before);
    expect(before.map((e) => e.sourceKey).sort()).toEqual(jpTrophies.map((t) => t.id).sort());
  });

  it("a PSN catalog list older than the player's: its rows arriving on a page open pay nothing twice", async () => {
    // matchPsnCatalog made the EU list (older: canonical) without trophies; the player's sync then
    // read the JP list of the same PS5 version and paid its trophies and platinum by own id/key.
    const { ensureTrophyList } = await import("@/lib/trophies/lists");
    const { loadPsnCatalogTrophies, PSN_OPEN_BUDGET_KEY, PSN_OPEN_COOLDOWN_KEY } = await import("@/lib/sync/psn-catalog-trophies");
    const CATALOG = "NPWR97301_00";
    await prisma.psnCatalogList.deleteMany({ where: { id: CATALOG } });
    await prisma.syncCursor.deleteMany({ where: { key: { in: [PSN_OPEN_BUDGET_KEY, PSN_OPEN_COOLDOWN_KEY] } } });
    try {
      const user = await newUser();
      const game = await newGame();
      await prisma.psnCatalogList.create({
        data: { id: CATALOG, name: "Lista", console: "PS5", serviceName: "trophy2", trophyCount: 2, tiers: { bronze: 1, silver: 0, gold: 0, platinum: 1 }, matchedAt: T0 },
      });
      const eu = await ensureTrophyList(prisma, { gameId: game.id, platform: "psn", externalId: CATALOG, console: "PS5", name: "Lista", serviceName: "trophy2", trophyCount: 2 });
      await prisma.trophyList.update({ where: { id: eu.id }, data: { createdAt: T0 } });
      const jp = await newList(game.id, "PS5", at(1));
      const jpTrophies = await newTrophies(game.id, jp.id);
      await prisma.userAchievement.createMany({
        data: jpTrophies.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(10 + i) })),
      });
      await prisma.userTrophyList.create({ data: { userId: user.id, listId: jp.id, unlockedCount: 2, completedAt: at(11) } });
      expect(await settle(user.id, [game.id])).toEqual({ paid: 3, voided: 0 });
      const before = await valid(user.id);
      expect(before.filter((e) => e.source === "achievement").map((e) => e.sourceKey).sort()).toEqual(jpTrophies.map((t) => t.id).sort());
      expect(before.filter((e) => e.source === "platinum").map((e) => e.sourceKey)).toEqual([`psn:PS5:${game.id}`]);

      // A visitor opens the game page: the catalog list's definitions are written (the canonical rows).
      const api = {
        getListTrophies: async () =>
          (["0", "1"] as const).map((id) => ({
            trophyId: id,
            name: `T${id}`,
            description: null,
            iconUrl: null,
            hidden: false,
            tier: id === "0" ? ("platinum" as const) : ("bronze" as const),
            earned: false,
            earnedAt: null,
            rarityPct: null,
          })),
      };
      expect(await loadPsnCatalogTrophies(game.id, api, NOW, { databaseBytes: async () => 0 })).toBe("loaded");
      expect(await prisma.achievement.count({ where: { listId: eu.id } })).toBe(2);

      // Nothing moves: the own-id entries stay, no stand-in under the new canonical ids, no second platinum.
      expect(await settle(user.id, [game.id])).toEqual({ paid: 0, voided: 0 });
      expect(await valid(user.id)).toEqual(before);
      expect(await rebuildListXp(user.id, NOW)).toEqual({ paid: 0, voided: 0 });
      const trophyAndPlatinum = (rows: Awaited<ReturnType<typeof valid>>) =>
        rows.filter((e) => e.source === "achievement" || e.source === "platinum").map((e) => [e.source, e.sourceKey, e.xp]);
      expect(trophyAndPlatinum(await valid(user.id))).toEqual(trophyAndPlatinum(before));
    } finally {
      await prisma.psnCatalogList.deleteMany({ where: { id: CATALOG } });
      await prisma.syncCursor.deleteMany({ where: { key: { in: [PSN_OPEN_BUDGET_KEY, PSN_OPEN_COOLDOWN_KEY] } } });
    }
  });

  /** Valid `achievement` entry keys (the fraud flow's recompute may also pay missions). */
  const trophyKeys = async (userId: string) =>
    (await valid(userId)).filter((e) => e.source === "achievement").map((e) => e.sourceKey);

  /** EU (canonical) and JP lists of one PS5 game with trophy "1" only; the player holds both copies. */
  async function bothRegions() {
    const user = await newUser();
    const game = await newGame();
    const eu = await newList(game.id, "PS5", T0);
    const jp = await newList(game.id, "PS5", at(1));
    const [euOne] = await newTrophies(game.id, eu.id, ["1"]);
    const [jpOne] = await newTrophies(game.id, jp.id, ["1"]);
    await prisma.userAchievement.createMany({
      data: [
        { userId: user.id, achievementId: euOne.id, unlockedAt: at(10) },
        { userId: user.id, achievementId: jpOne.id, unlockedAt: at(20) },
      ],
    });
    return { user, game, euOne, jpOne };
  }

  it("fraud on the canonical copy (pinned): both copies paid by own id, confirming EU voids the EU entry only", async () => {
    const { user, game, euOne, jpOne } = await bothRegions();
    expect(await settle(user.id, [game.id])).toEqual({ paid: 2, voided: 0 });

    // Confirmed fraud on the EU copy: its entry is voided; the clean JP copy keeps its own entry.
    expect(await voidFraudEntries(user.id, [euOne.id], at(30))).toBe(1);
    expect(await trophyKeys(user.id)).toEqual([jpOne.id]);
    expect(await settle(user.id, [game.id], at(31))).toEqual({ paid: 0, voided: 0 });
  });

  it("fraud on the canonical copy (pinned): paid once under the canonical id, confirming EU leaves it paying the clean JP copy", async () => {
    // The once-per-version rule paid the trophy once, under the canonical EU id; JP has no entry.
    const { user, game, euOne, jpOne } = await bothRegions();
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "achievement", sourceKey: euOne.id, platform: "psn", xp: tierXp("bronze"), skills: ["rpg"], createdAt: at(10) },
    });

    // Confirmed fraud on EU: the JP copy becomes the stand-in under the canonical id, so that entry
    // stays valid (one payment for the one clean unlock) and no JP own-id entry is created.
    expect(await voidFraudEntries(user.id, [euOne.id], at(30))).toBe(0);
    expect(await trophyKeys(user.id)).toEqual([euOne.id]);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, sourceKey: jpOne.id } })).toBe(0);
    expect(await settle(user.id, [game.id], at(31))).toEqual({ paid: 0, voided: 0 });
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

  it("a game whose lists were never read keeps its list-less XP through rebuildListXp", async () => {
    // After the backfill a multi-list game has its (empty) lists and the old list-less rows; a
    // player whose lists were not read again (no credential, private, failed, cut short) has no
    // UserTrophyList of it and keeps every entry, legacy platinum included.
    const user = await newUser();
    const game = await newGame();
    await newList(game.id, "PS4", T0);
    await newList(game.id, "PS5", at(1));
    const old = await newTrophies(game.id, null);
    await prisma.userAchievement.createMany({
      data: old.map((t, i) => ({ userId: user.id, achievementId: t.id, unlockedAt: at(i) })),
    });
    await prisma.userGame.create({
      data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 0, unlockedCount: 2, completedAt: at(1) },
    });
    await prisma.xpLedgerEntry.createMany({
      data: [
        ...old.map((t, i) => ({
          userId: user.id,
          source: "achievement",
          sourceKey: t.id,
          platform: "psn",
          xp: tierXp(t.trophyTier ?? "bronze"),
          skills: ["rpg"],
          createdAt: at(i),
        })),
        {
          userId: user.id,
          source: "platinum",
          sourceKey: `psn:${game.id}`,
          platform: "psn",
          xp: platinumBonus([tierXp("platinum"), tierXp("bronze")]),
          skills: ["rpg"],
          createdAt: at(1),
        },
      ],
    });
    const trophyEntries = async () =>
      (await valid(user.id)).filter((e) => e.source === "achievement" || e.source === "platinum");
    const before = await trophyEntries();
    expect(before).toHaveLength(3);

    expect(await rebuildListXp(user.id, NOW)).toEqual({ paid: 0, voided: 0 });
    expect(await trophyEntries()).toEqual(before);
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
