import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { platinumTallyOf } from "@/lib/character/counts";
import { playtimeSourceKey } from "@/lib/engine/playtime";
import { settleListXp } from "@/lib/progression/list-xp";
import { recomputeUser } from "@/lib/progression/recompute";
import { settlePlaytime } from "@/lib/sync/playtime";
import { GAME_REFS } from "./duplicates";
import { mergeGames, MergeRefused, mergeOrder } from "./merge-games";
import { loadSlugRedirect } from "./redirects";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-mrg` prefix and are removed.
const PREFIX = "test-mrg";
const NOW = new Date("2026-11-06T12:00:00Z");
const T0 = new Date("2026-10-01T12:00:00Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

let counter = 0;
const next = () => `${PREFIX}-${++counter}`;

async function cleanup() {
  await prisma.guideRequest.deleteMany({ where: { reason: { startsWith: PREFIX } } });
  await prisma.externalNews.deleteMany({ where: { url: { startsWith: `https://${PREFIX}` } } });
  await prisma.forumThread.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.photo.deleteMany({ where: { caption: { startsWith: PREFIX } } });
  await prisma.article.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.author.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await prisma.gameSlugRedirect.deleteMany({ where: { fromSlug: { startsWith: PREFIX } } });
  await prisma.game.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
}

beforeAll(cleanup);
afterAll(cleanup);

const newUser = () => prisma.user.create({ data: { handle: next(), displayName: "Teste" } });

const newGame = (extra: Record<string, unknown> = {}) => {
  const slug = next();
  return prisma.game.create({
    data: { slug, name: `Jogo ${slug}`, achievementCount: 0, platforms: ["PLAYSTATION"], skills: { create: [{ skill: "rpg" }] }, ...extra },
  });
};

const newList = (gameId: string, console: string | null, createdAt: Date, name = "Lista", platform = "psn") =>
  prisma.trophyList.create({ data: { gameId, platform, externalId: next(), console, name, createdAt, trophyCount: 2 } });

/** Trophies "0" (platinum) and "1" (bronze) of a PSN list. */
async function newTrophies(gameId: string, listId: string, globalPct: number | null = null) {
  const rows = [];
  for (const apiName of ["0", "1"]) {
    rows.push(
      await prisma.achievement.create({
        data: { gameId, platform: "psn", listId, apiName, name: `T${apiName}`, trophyTier: apiName === "0" ? "platinum" : "bronze", globalPct },
      }),
    );
  }
  return rows;
}

/** The user unlocks every trophy of the list (at `start`, `start + 1` min) and completes it. */
async function complete(userId: string, listId: string, trophies: { id: string }[], start: number) {
  await prisma.userAchievement.createMany({ data: trophies.map((t, i) => ({ userId, achievementId: t.id, unlockedAt: at(start + i) })) });
  await prisma.userTrophyList.create({ data: { userId, listId, unlockedCount: trophies.length, completedAt: at(start + trophies.length - 1) } });
}

const settle = (userId: string, gameId: string) => prisma.$transaction((tx) => settleListXp(tx, userId, "psn", [gameId], NOW));
const validLedger = (userId: string) =>
  prisma.xpLedgerEntry.findMany({ where: { userId, voidedAt: null }, orderBy: [{ source: "asc" }, { sourceKey: "asc" }] });
const xpOf = async (userId: string) => (await validLedger(userId)).reduce((sum, e) => sum + e.xp, 0);
const totalXp = async (userId: string) => (await prisma.userStats.findUniqueOrThrow({ where: { userId } })).totalXp;

async function countRows(): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table_name}"`);
    counts[table_name] = Number(row.n);
  }
  return counts;
}

/** A drop game with one row in every table that references a game (GAME_REFS). */
async function dropWithEverything(userId: string) {
  const steamAppId = 97400100 + ++counter;
  const keep = await newGame({ steamAppId: null });
  const drop = await newGame({ steamAppId, igdbId: 555, summary: "Resumo do drop", aliases: ["Apelido do drop"] });
  const [e1, e2] = [await newGame(), await newGame()];
  const list = await newList(drop.id, "PS4", T0);
  const [plat] = await newTrophies(drop.id, list.id);
  await prisma.userAchievement.create({ data: { userId, achievementId: plat.id, unlockedAt: at(0) } });
  await prisma.userGame.create({ data: { userId, gameId: drop.id, platform: "psn", playtimeMin: 30, unlockedCount: 1 } });
  await prisma.gamePlatformLink.create({ data: { gameId: drop.id, platform: "psn", externalId: list.externalId } });
  await prisma.gameMedia.create({ data: { gameId: drop.id, kind: "cover", url: `https://${PREFIX}/cover.png`, source: "fixture" } });
  await prisma.steamPlayerCount.create({
    data: { gameId: drop.id, current: 10, sampledAt: NOW, todayPeak: 12, todayPeakDay: NOW, allTimePeak: 20, allTimePeakAt: NOW },
  });
  await prisma.guide.create({
    data: { gameId: drop.id, status: "draft", version: "1", difficulty: 3, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 0, online: 0, overview: [], warnings: [] },
  });
  await prisma.guideRequest.create({ data: { steamAppId, gameId: drop.id, status: "queued", reason: `${PREFIX} pedido` } });
  await prisma.forumThread.create({ data: { gameId: drop.id, title: "Tópico", slug: next() } });
  await prisma.photo.create({ data: { gameId: drop.id, width: 10, height: 10, caption: `${PREFIX} foto` } });
  await prisma.wishlistItem.create({ data: { userId, gameId: drop.id, platform: "steam" } });
  const author = await prisma.author.create({ data: { handle: next() } });
  const article = await prisma.article.create({
    data: { slug: next(), title: "Artigo", body: "", category: "GAMES", platforms: [], imageLabel: "x", authorId: author.id, gameId: drop.id },
  });
  await prisma.articleGame.create({ data: { articleId: article.id, gameId: drop.id } });
  await prisma.externalNews.create({ data: { gameId: drop.id, title: "Notícia", url: `https://${PREFIX}/${next()}`, source: "Fonte", publishedAt: NOW } });
  await prisma.gameRelease.create({ data: { gameId: drop.id, platform: "PC", source: "igdb", seenAt: NOW } });
  await prisma.gameOpen.create({ data: { userId, gameId: drop.id } });
  await prisma.gameSlugRedirect.create({ data: { fromSlug: next(), gameId: drop.id } });
  await prisma.gameIgdbAlias.create({ data: { igdbId: 97400000 + counter, gameId: drop.id } });
  // The drop as gameId and as otherId of an edition pair, and a pair with the keep (it becomes a self-pair).
  await prisma.gameEdition.create({ data: { gameId: drop.id, otherId: e1.id } });
  await prisma.gameEdition.create({ data: { gameId: e2.id, otherId: drop.id } });
  await prisma.gameEdition.create({ data: { gameId: keep.id, otherId: drop.id } });
  return { keep, drop, e1, e2, steamAppId };
}

describe("mergeGames", () => {
  it("every table with gameId moves", async () => {
    const user = await newUser();
    const { keep, drop, e1, e2, steamAppId } = await dropWithEverything(user.id);
    const oldRedirects = (await prisma.gameSlugRedirect.findMany({ where: { gameId: drop.id } })).map((r) => r.fromSlug);

    const report = await mergeGames(keep.id, drop.id, { dryRun: false, now: NOW });

    for (const ref of GAME_REFS) {
      const [left] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${ref.model}" WHERE "${ref.column}" = $1`, drop.id);
      expect(Number(left.n), `${ref.model}.${ref.column} still points at the drop`).toBe(0);
      expect(report.moved[ref.key], `moved.${ref.key}`).toBeGreaterThan(0);
    }
    for (const ref of GAME_REFS.filter((r) => r.model !== "GameEdition")) {
      const [kept] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${ref.model}" WHERE "${ref.column}" = $1`, keep.id);
      expect(Number(kept.n), `${ref.model}.${ref.column} on the keep`).toBeGreaterThan(0);
    }
    // Edition pairs follow the keep, stored once (smaller id first); the pair with the keep itself is gone.
    const pairs = await prisma.gameEdition.findMany({ where: { OR: [{ gameId: keep.id }, { otherId: keep.id }] } });
    const others = pairs.map((p) => (p.gameId === keep.id ? p.otherId : p.gameId)).sort();
    expect(others).toEqual([e1.id, e2.id].sort());
    expect(pairs.every((p) => p.gameId < p.otherId)).toBe(true);

    expect(await prisma.game.findUnique({ where: { id: drop.id } })).toBeNull();
    const kept = await prisma.game.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept.steamAppId).toBe(steamAppId);
    expect(kept.igdbId).toBe(555);
    expect(kept.summary).toBe("Resumo do drop");
    expect(kept.aliases).toEqual(expect.arrayContaining([drop.name, "Apelido do drop"]));
    // The old slug and every redirect that pointed at the drop lead to the keep.
    for (const slug of [drop.slug, ...oldRedirects]) expect(await loadSlugRedirect(slug)).toBe(keep.slug);
    expect(report.redirects.sort()).toEqual([drop.slug, ...oldRedirects].sort());
    expect(report.usersRecomputed).toEqual([user.id]);
  });

  it("user rows merge playtime and unlocks", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    const keepList = await newList(keep.id, "PS4", T0);
    const dropList = await newList(drop.id, "PS5", at(5));
    const keepTrophies = await newTrophies(keep.id, keepList.id);
    const dropTrophies = await newTrophies(drop.id, dropList.id);
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: keepTrophies[1].id, unlockedAt: at(1) } });
    await complete(user.id, dropList.id, dropTrophies, 10);
    await prisma.userGame.create({
      data: {
        userId: user.id, gameId: keep.id, platform: "psn", playtimeMin: 60, unlockedCount: 1, lastPlayedAt: at(100),
        playtime2WeeksMin: 10, checkedPlaytimeMin: 50, playtimePaidMin: 40,
      },
    });
    await prisma.userGame.create({
      data: {
        userId: user.id, gameId: drop.id, platform: "psn", playtimeMin: 120, unlockedCount: 2, completedAt: at(11), lastPlayedAt: at(200),
        playtime2WeeksMin: 30, checkedPlaytimeMin: 99, playtimePaidMin: 99,
      },
    });
    // A Steam row only the drop has moves as it is.
    await prisma.userGame.create({ data: { userId: user.id, gameId: drop.id, platform: "steam", playtimeMin: 15, unlockedCount: 0 } });
    const unlocksBefore = await prisma.userAchievement.count({ where: { userId: user.id } });

    await mergeGames(keep.id, drop.id, { dryRun: false, now: NOW });

    const rows = await prisma.userGame.findMany({ where: { userId: user.id }, orderBy: { platform: "asc" } });
    expect(rows.map((r) => [r.gameId, r.platform])).toEqual([[keep.id, "psn"], [keep.id, "steam"]]);
    const psn = rows[0];
    expect(psn.playtimeMin).toBe(180);
    expect(psn.unlockedCount).toBe(3);
    expect(psn.completedAt).toEqual(at(11));
    expect(psn.lastPlayedAt).toEqual(at(200));
    expect(psn.playtime2WeeksMin).toBe(30);
    expect(psn.checkedPlaytimeMin).toBe(50);
    expect(psn.playtimePaidMin).toBe(40);
    expect(rows[1].playtimeMin).toBe(15);
    // No unlock is lost: every one now sits on the keep.
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(unlocksBefore);
    expect(await prisma.userAchievement.count({ where: { userId: user.id, achievement: { gameId: keep.id } } })).toBe(unlocksBefore);
    expect(await prisma.userTrophyList.count({ where: { userId: user.id, list: { gameId: keep.id } } })).toBe(1);
  });

  it("hour milestones are not paid twice after a merge", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    // 6 h on each: both paid the 5 h milestone. Merged: 12 h, milestones 5 h and 10 h.
    await prisma.userGame.create({ data: { userId: user.id, gameId: keep.id, platform: "psn", playtimeMin: 360, unlockedCount: 0 } });
    await prisma.userGame.create({ data: { userId: user.id, gameId: drop.id, platform: "psn", playtimeMin: 360, unlockedCount: 0 } });
    // 20 h on each on Xbox: both paid 5 h and 10 h. Merged: 40 h, milestones 5, 10 and 25 h.
    await prisma.userGame.create({ data: { userId: user.id, gameId: keep.id, platform: "xbox", playtimeMin: 1200, unlockedCount: 0 } });
    await prisma.userGame.create({ data: { userId: user.id, gameId: drop.id, platform: "xbox", playtimeMin: 1200, unlockedCount: 0 } });
    for (const platform of ["psn", "xbox"] as const) {
      await prisma.$transaction((tx) => settlePlaytime(tx, user.id, platform, at(10)));
    }
    const before = await validLedger(user.id);
    expect(before.map((e) => e.sourceKey).sort()).toEqual(
      [
        playtimeSourceKey("psn", keep.id, 5), playtimeSourceKey("psn", drop.id, 5),
        playtimeSourceKey("xbox", keep.id, 5), playtimeSourceKey("xbox", keep.id, 10),
        playtimeSourceKey("xbox", drop.id, 5), playtimeSourceKey("xbox", drop.id, 10),
      ].sort(),
    );
    const xpBefore = await xpOf(user.id);

    await mergeGames(keep.id, drop.id, { dryRun: false, now: NOW });

    // Every milestone key of the kept game is in the ledger once; nothing was lost.
    const after = await validLedger(user.id);
    expect(await xpOf(user.id)).toBe(xpBefore);
    const keys = after.map((e) => e.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([playtimeSourceKey("psn", keep.id, 10), playtimeSourceKey("xbox", keep.id, 25)]));
    // The drop's 5 h moved onto the 10 h the merged hours reached, with its own XP and date.
    const psn10 = after.find((e) => e.sourceKey === playtimeSourceKey("psn", keep.id, 10))!;
    const drop5 = before.find((e) => e.sourceKey === playtimeSourceKey("psn", drop.id, 5))!;
    expect([psn10.xp, psn10.createdAt]).toEqual([drop5.xp, drop5.createdAt]);

    // The next syncs pay nothing for hours already paid.
    for (const platform of ["psn", "xbox"] as const) {
      const result = await prisma.$transaction((tx) => settlePlaytime(tx, user.id, platform, NOW));
      expect(result.paid).toEqual([]);
    }
    expect(await xpOf(user.id)).toBe(xpBefore);
  });

  it("regional lists of two duplicates count once after the merge", async () => {
    for (const dropOlder of [false, true]) {
      const user = await newUser();
      const keep = await newGame();
      const drop = await newGame();
      // Two PS4 lists of one game (EU and JP), one on each duplicate; the JP trophies are rarer (worth more).
      const keepList = await newList(keep.id, "PS4", dropOlder ? at(1) : T0, "Jogo");
      const dropList = await newList(drop.id, "PS4", dropOlder ? T0 : at(1), "ゲーム");
      const keepTrophies = await newTrophies(keep.id, keepList.id);
      const dropTrophies = await newTrophies(drop.id, dropList.id, 2);
      await complete(user.id, keepList.id, keepTrophies, 0);
      await complete(user.id, dropList.id, dropTrophies, 10);
      await prisma.userGame.create({ data: { userId: user.id, gameId: keep.id, platform: "psn", playtimeMin: 0, unlockedCount: 2, completedAt: at(1) } });
      await prisma.userGame.create({ data: { userId: user.id, gameId: drop.id, platform: "psn", playtimeMin: 0, unlockedCount: 2, completedAt: at(11) } });
      await settle(user.id, keep.id);
      await settle(user.id, drop.id);
      await recomputeUser(user.id, NOW);
      const xpBefore = await totalXp(user.id);
      const tallyBefore = await platinumTallyOf(user.id);
      expect([tallyBefore.platinums, tallyBefore.perVersion]).toEqual([2, 2]);

      await mergeGames(keep.id, drop.id, { dryRun: false, now: NOW });

      // One version (PS4) of one game; each list keeps its platinum and trophies, paid once.
      const tally = await platinumTallyOf(user.id);
      expect([tally.platinums, tally.perVersion, tally.tralked]).toEqual([2, 1, 2]);
      expect(await totalXp(user.id), dropOlder ? "drop list older" : "keep list older").toBe(xpBefore);
      const ledger = await validLedger(user.id);
      const platinumKeys = ledger.filter((e) => e.source === "platinum").map((e) => e.sourceKey).sort();
      const perList = dropOlder ? keepList.externalId : dropList.externalId;
      expect(platinumKeys).toEqual([`psn:${perList}:${keep.id}`, `psn:PS4:${keep.id}`].sort());
      expect(ledger.filter((e) => e.source === "achievement").map((e) => e.sourceKey).sort()).toEqual(
        [...keepTrophies, ...dropTrophies].map((t) => t.id).sort(),
      );
      // Settling again changes nothing.
      expect(await settle(user.id, keep.id)).toEqual({ paid: 0, voided: 0 });
    }
  });

  it("two steam games are refused", async () => {
    const a = await newGame({ steamAppId: 97400010 });
    const b = await newGame({ steamAppId: 97400011 });
    await expect(mergeGames(a.id, b.id, { dryRun: false, now: NOW })).rejects.toBeInstanceOf(MergeRefused);
    await expect(mergeGames(a.id, b.id, { dryRun: true, now: NOW })).rejects.toThrow(/steam/i);
    // Two games with a guide, and a game with itself, are refused too.
    const guide = (gameId: string) =>
      prisma.guide.create({
        data: { gameId, status: "draft", version: "1", difficulty: 3, hoursMin: 1, hoursMax: 2, playthroughs: "1", missables: 0, online: 0, overview: [], warnings: [] },
      });
    const c = await newGame();
    const d = await newGame();
    await guide(c.id);
    await guide(d.id);
    await expect(mergeGames(c.id, d.id, { dryRun: false, now: NOW })).rejects.toThrow(/guia/i);
    await expect(mergeGames(c.id, c.id, { dryRun: false, now: NOW })).rejects.toBeInstanceOf(MergeRefused);
    expect(await prisma.game.count({ where: { id: { in: [a.id, b.id, c.id, d.id] } } })).toBe(4);
  });

  it("A→B then B→C redirects A to C", async () => {
    const a = await newGame();
    const b = await newGame();
    const c = await newGame();
    await mergeGames(b.id, a.id, { dryRun: false, now: NOW });
    expect(await loadSlugRedirect(a.slug)).toBe(b.slug);
    const report = await mergeGames(c.id, b.id, { dryRun: false, now: NOW });
    expect(await loadSlugRedirect(a.slug)).toBe(c.slug);
    expect(await loadSlugRedirect(b.slug)).toBe(c.slug);
    expect(report.redirects.sort()).toEqual([a.slug, b.slug].sort());
  });

  it("dry run writes nothing", async () => {
    const user = await newUser();
    const { keep, drop } = await dropWithEverything(user.id);
    await prisma.xpLedgerEntry.create({
      data: { userId: user.id, source: "playtime", sourceKey: playtimeSourceKey("psn", drop.id, 5), platform: "psn", xp: 100, skills: [] },
    });
    const before = await countRows();
    const ledgerBefore = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } });

    const report = await mergeGames(keep.id, drop.id, { dryRun: true, now: NOW });

    expect(await countRows()).toEqual(before);
    expect(await prisma.xpLedgerEntry.findMany({ where: { userId: user.id } })).toEqual(ledgerBefore);
    expect(await prisma.game.findUnique({ where: { id: drop.id } })).not.toBeNull();
    expect(report.moved.userGames).toBe(1);
    expect(report.moved.ledger).toBe(1);
    expect(report.usersRecomputed).toEqual([user.id]);
    expect(report.redirects).toContain(drop.slug);
  });

  it("a missing GAME_REFS table aborts the merge", async () => {
    const keep = await newGame();
    const drop = await newGame();
    await prisma.gameOpen.create({ data: { userId: (await newUser()).id, gameId: drop.id } });
    await prisma.$executeRawUnsafe(`ALTER TABLE "GameOpen" RENAME TO "GameOpen_hidden_by_test"`);
    try {
      await expect(mergeGames(keep.id, drop.id, { dryRun: false, now: NOW })).rejects.toThrow(/GameOpen/);
      await expect(mergeGames(keep.id, drop.id, { dryRun: true, now: NOW })).rejects.toThrow(/GameOpen/);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "GameOpen_hidden_by_test" RENAME TO "GameOpen"`);
    }
    expect(await prisma.game.findUnique({ where: { id: drop.id } })).not.toBeNull();
    expect(await prisma.gameOpen.count({ where: { gameId: drop.id } })).toBe(1);
  });
});

describe("mergeGames: folded rows, refusals and the ledger", () => {
  it("recompute: false leaves the players to the caller", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    await prisma.userGame.create({ data: { userId: user.id, gameId: drop.id, platform: "psn", playtimeMin: 10, unlockedCount: 0 } });
    const report = await mergeGames(keep.id, drop.id, { now: NOW, recompute: false });
    expect(report.usersRecomputed).toEqual([user.id]);
    expect(await prisma.userStats.findUnique({ where: { userId: user.id } })).toBeNull();
    // The default recomputes.
    const other = await newGame();
    await prisma.userGame.create({ data: { userId: user.id, gameId: other.id, platform: "xbox", playtimeMin: 10, unlockedCount: 0 } });
    await mergeGames(keep.id, other.id, { now: NOW });
    expect(await prisma.userStats.findUnique({ where: { userId: user.id } })).not.toBeNull();
  });

  it("an unlink-voided drop key is copied voided and never paid again on the keep", async () => {
    const user = await newUser();
    const voidedAt = at(500);
    await prisma.linkedAccount.create({ data: { userId: user.id, platform: "psn", externalId: next(), handle: "psn", linkedAt: at(600) } });
    const keep = await newGame();
    const drop = await newGame();
    const list = await newList(drop.id, "PS4", T0);
    const trophies = await newTrophies(drop.id, list.id);
    await complete(user.id, list.id, trophies, 0);
    // Paid before the unlink, voided by it; the relinked account synced the same unlocks again.
    await prisma.xpLedgerEntry.createMany({
      data: [
        ...trophies.map((t, i) => ({ userId: user.id, source: "achievement", sourceKey: t.id, platform: "psn", xp: 10, skills: [], createdAt: at(i), voidedAt })),
        { userId: user.id, source: "platinum", sourceKey: `psn:PS4:${drop.id}`, platform: "psn", xp: 5, skills: [], createdAt: at(1), voidedAt },
      ],
    });
    expect(await settle(user.id, drop.id)).toEqual({ paid: 0, voided: 0 });

    await mergeGames(keep.id, drop.id, { now: NOW });

    const copy = await prisma.xpLedgerEntry.findUniqueOrThrow({
      where: { userId_source_sourceKey: { userId: user.id, source: "platinum", sourceKey: `psn:PS4:${keep.id}` } },
    });
    expect([copy.voidedAt, copy.xp, copy.createdAt]).toEqual([voidedAt, 5, at(1)]);
    expect(await validLedger(user.id)).toEqual([]);
    expect(await settle(user.id, keep.id)).toEqual({ paid: 0, voided: 0 });
  });

  it("a platinum with no slot on the keep is refused and rolls back fully (legacy keys)", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    for (const g of [keep, drop]) {
      await prisma.userGame.create({ data: { userId: user.id, gameId: g.id, platform: "psn", playtimeMin: 0, unlockedCount: 0, completedAt: at(1) } });
      await prisma.xpLedgerEntry.create({ data: { userId: user.id, source: "platinum", sourceKey: `psn:${g.id}`, platform: "psn", xp: 50, skills: [] } });
    }
    const dry = await mergeGames(keep.id, drop.id, { dryRun: true, now: NOW });
    expect([dry.moved.platinumCollisions, dry.likelyRefused]).toEqual([1, true]);
    const before = await countRows();
    const ledgerBefore = await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });

    await expect(mergeGames(keep.id, drop.id, { now: NOW })).rejects.toBeInstanceOf(MergeRefused);

    expect(await countRows()).toEqual(before);
    expect(await prisma.xpLedgerEntry.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(ledgerBefore);
    expect(await prisma.userGame.count({ where: { gameId: drop.id } })).toBe(1);
  });

  it("two Steam platinums of the same player are refused", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    for (const g of [keep, drop]) {
      await prisma.userGame.create({ data: { userId: user.id, gameId: g.id, platform: "steam", playtimeMin: 0, unlockedCount: 0, completedAt: at(1) } });
      await prisma.xpLedgerEntry.create({ data: { userId: user.id, source: "platinum", sourceKey: g.id, platform: null, xp: 70, skills: [] } });
    }
    const dry = await mergeGames(keep.id, drop.id, { dryRun: true, now: NOW });
    expect([dry.moved.platinumCollisions, dry.likelyRefused]).toEqual([1, true]);
    const before = await countRows();
    await expect(mergeGames(keep.id, drop.id, { now: NOW })).rejects.toThrow(/platina/);
    expect(await countRows()).toEqual(before);
    expect(await validLedger(user.id)).toHaveLength(2);
  });

  it("rewrites a mission condition that names the drop", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    const mission = await prisma.mission.create({
      data: { userId: user.id, kind: "daily", periodKey: "2020-01-01", title: next(), condition: { minCount: 1, gameId: drop.id }, rewardXp: 0 },
    });
    await mergeGames(keep.id, drop.id, { now: NOW });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).condition).toEqual({ minCount: 1, gameId: keep.id });
  });

  it("media are not repeated (url, video, placeholder of a kind) and GameOpen keeps the earliest open", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    const media = (gameId: string, kind: string, url: string | null, youtubeId: string | null = null) =>
      prisma.gameMedia.create({ data: { gameId, kind, url, youtubeId, source: "fixture" } });
    await media(keep.id, "video", null, "abc");
    await media(keep.id, "cover", null);
    await media(keep.id, "cover", `https://${PREFIX}/u1.png`);
    await media(drop.id, "video", null, "abc"); // same video
    await media(drop.id, "video", null, "xyz");
    await media(drop.id, "cover", null); // a cover placeholder the keep has
    await media(drop.id, "hero", null);
    await media(drop.id, "cover", `https://${PREFIX}/u1.png`); // same url
    await media(drop.id, "cover", `https://${PREFIX}/u2.png`);
    await prisma.gameOpen.create({ data: { userId: user.id, gameId: keep.id, openedAt: at(100) } });
    await prisma.gameOpen.create({ data: { userId: user.id, gameId: drop.id, openedAt: at(5) } });

    await mergeGames(keep.id, drop.id, { now: NOW });

    const rows = await prisma.gameMedia.findMany({ where: { gameId: keep.id } });
    expect(rows.map((m) => `${m.kind}:${m.url ?? m.youtubeId ?? "-"}`).sort()).toEqual(
      ["cover:-", `cover:https://${PREFIX}/u1.png`, `cover:https://${PREFIX}/u2.png`, "hero:-", "video:abc", "video:xyz"].sort(),
    );
    expect(await prisma.gameOpen.findMany({ where: { userId: user.id }, select: { gameId: true, openedAt: true } })).toEqual([
      { gameId: keep.id, openedAt: at(5) },
    ]);
  });

  it("recounts the keep's row of a player whose unlocks came without a drop row", async () => {
    const user = await newUser();
    const keep = await newGame();
    const drop = await newGame();
    const keepList = await newList(keep.id, "PS4", T0);
    const dropList = await newList(drop.id, "PS5", at(1));
    const [, keepBronze] = await newTrophies(keep.id, keepList.id);
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: keepBronze.id, unlockedAt: at(2) } });
    await prisma.userGame.create({ data: { userId: user.id, gameId: keep.id, platform: "psn", playtimeMin: 0, unlockedCount: 1 } });
    await complete(user.id, dropList.id, await newTrophies(drop.id, dropList.id), 10);

    await mergeGames(keep.id, drop.id, { now: NOW });

    const row = await prisma.userGame.findUniqueOrThrow({ where: { userId_gameId_platform: { userId: user.id, gameId: keep.id, platform: "psn" } } });
    expect(row.unlockedCount).toBe(3);
  });
});

describe("mergeOrder", () => {
  it("runs a chain A→B, B→C from its leaf, whatever the order of the list", async () => {
    expect(mergeOrder([{ keep: "c", drop: "b" }, { keep: "b", drop: "a" }])).toEqual([
      { keep: "b", drop: "a" },
      { keep: "c", drop: "b" },
    ]);
    // Run in that order, the chain ends with A and B on C.
    const a = await newGame();
    const b = await newGame();
    const c = await newGame();
    const user = await newUser();
    await prisma.userGame.create({ data: { userId: user.id, gameId: a.id, platform: "psn", playtimeMin: 5, unlockedCount: 0 } });
    for (const pair of mergeOrder([{ keep: c.id, drop: b.id }, { keep: b.id, drop: a.id }])) {
      await mergeGames(pair.keep, pair.drop, { dryRun: false, now: NOW });
    }
    expect(await loadSlugRedirect(a.slug)).toBe(c.slug);
    expect(await prisma.userGame.findMany({ where: { userId: user.id }, select: { gameId: true } })).toEqual([{ gameId: c.id }]);
  });

  it("refuses a cycle, a game dropped twice and a game joined to itself", () => {
    expect(() => mergeOrder([{ keep: "a", drop: "b" }, { keep: "b", drop: "a" }])).toThrow(/cycle|ciclo/i);
    expect(() => mergeOrder([{ keep: "a", drop: "c" }, { keep: "b", drop: "c" }])).toThrow(/c is dropped in two joins/);
    expect(() => mergeOrder([{ keep: "a", drop: "a" }])).toThrow(/joined to itself/);
  });
});
