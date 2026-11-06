import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { versionKey } from "@/lib/trophies/lists";
import { LIST_PLATFORMS, settleListXp } from "@/lib/progression/list-xp";
import { platinumTally } from "./counts";

// Test database only (vitest.db-guard.ts). Fixtures use the `test-a7c` prefix and are removed.
const PREFIX = "test-a7c";
const T0 = new Date("2026-10-20T12:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
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
async function newGame(name: string) {
  counter++;
  return prisma.game.create({ data: { slug: `${PREFIX}-${counter}`, name, achievementCount: 0, platforms: [] } });
}

type ListDef = {
  platform: string;
  console: string;
  /** The list has a platinum trophy ("0"). */
  platinumTrophy?: boolean;
  /** Trophies the player earned, in order ("0" first). */
  earned: number;
  completed?: boolean;
  /** The last earned trophy is suspicious. */
  suspicious?: boolean;
};

/** A trophy list of 3 trophies (the first a platinum when `platinumTrophy`), with the player's progress. */
async function addList(userId: string, gameId: string, d: ListDef) {
  counter++;
  const list = await prisma.trophyList.create({
    data: { gameId, platform: d.platform, externalId: `${PREFIX}-L${counter}`, console: d.console, name: "Lista", createdAt: at(counter) },
  });
  const rows = await prisma.achievement.createManyAndReturn({
    data: ["0", "1", "2"].map((apiName) => ({
      gameId,
      platform: d.platform,
      listId: list.id,
      apiName,
      name: `T${apiName}`,
      trophyTier: d.platform === "psn" ? (apiName === "0" && d.platinumTrophy ? "platinum" : "bronze") : null,
      globalPct: 40,
    })),
  });
  const earned = rows.sort((a, b) => a.apiName.localeCompare(b.apiName)).slice(0, d.earned);
  await prisma.userAchievement.createMany({
    data: earned.map((r, n) => ({
      userId,
      achievementId: r.id,
      unlockedAt: at(100 + counter * 3 + n),
      suspicious: Boolean(d.suspicious) && n === earned.length - 1,
    })),
  });
  await prisma.userTrophyList.create({
    data: { userId, listId: list.id, unlockedCount: d.earned, completedAt: d.completed ? at(200 + counter) : null },
  });
}

describe("platinumTally", () => {
  it("PS4 + two PS5 regions, each platinum = 3 platinums, all 3 on PSN (2 versions)", async () => {
    const user = await newUser();
    const game = await newGame("Jogo");
    for (const console of ["PS4", "PS5", "PS5"]) {
      await addList(user.id, game.id, { platform: "psn", console, platinumTrophy: true, earned: 3, completed: true });
    }
    expect(await platinumTally(user.id)).toMatchObject({ platinums: 3, psnPlatinums: 3, perVersion: 2 });
  });

  it("PS4 + PS5 without a platinum trophy, both 100% = 2", async () => {
    const user = await newUser();
    const game = await newGame("Indie");
    await addList(user.id, game.id, { platform: "psn", console: "PS4", earned: 3, completed: true });
    await addList(user.id, game.id, { platform: "psn", console: "PS5", earned: 3, completed: true });
    expect((await platinumTally(user.id)).platinums).toBe(2);
  });

  it("Xbox with two titleIds both complete = 2", async () => {
    const user = await newUser();
    const game = await newGame("Halo");
    await addList(user.id, game.id, { platform: "xbox", console: "ONE", earned: 3, completed: true });
    await addList(user.id, game.id, { platform: "xbox", console: "PC", earned: 3, completed: true });
    expect((await platinumTally(user.id)).platinums).toBe(2);
  });

  it("a platinum trophy on a list short of 100% (DLC) counts 1", async () => {
    const user = await newUser();
    const game = await newGame("DLC");
    await addList(user.id, game.id, { platform: "psn", console: "PS4", platinumTrophy: true, earned: 2 });
    expect(await platinumTally(user.id)).toMatchObject({ platinums: 1, psnPlatinums: 1, perVersion: 1 });
  });

  it("the header equals the platinums the ledger pays (one per list), on a mixed library", async () => {
    const user = await newUser();
    // PSN: a platinum on PS5 plus a PS4 100% without a platinum trophy (no "covered" across versions).
    const mixed = await newGame("Misto");
    await addList(user.id, mixed.id, { platform: "psn", console: "PS5", platinumTrophy: true, earned: 3, completed: true });
    await addList(user.id, mixed.id, { platform: "psn", console: "PS4", earned: 3, completed: true });
    // A second region of the PS5 version, platinum too: a platinum of its own.
    await addList(user.id, mixed.id, { platform: "psn", console: "PS5", platinumTrophy: true, earned: 3, completed: true });
    // PSN: the platinum trophy without the list at 100% (DLC missing): paid as that trophy.
    const dlc = await newGame("DLC");
    await addList(user.id, dlc.id, { platform: "psn", console: "PS4", platinumTrophy: true, earned: 2 });
    // PSN: a list with a suspicious unlock pays no platinum; the clean region of the version does.
    const tainted = await newGame("Suspeito");
    await addList(user.id, tainted.id, { platform: "psn", console: "PS5", earned: 3, completed: true, suspicious: true });
    await addList(user.id, tainted.id, { platform: "psn", console: "PS5", earned: 3, completed: true });
    // Xbox: two titleIds; RA: one set.
    const halo = await newGame("Halo");
    await addList(user.id, halo.id, { platform: "xbox", console: "360", earned: 3, completed: true });
    await addList(user.id, halo.id, { platform: "xbox", console: "ONE", earned: 3, completed: true });
    const snes = await newGame("SNES");
    await addList(user.id, snes.id, { platform: "retro", console: "SNES", earned: 3, completed: true });
    // A PSN 100% with no list yet (legacy key), and a Steam 100%.
    const legacy = await newGame("Legado");
    const steam = await newGame("Steam");
    await prisma.userGame.createMany({
      data: [
        { userId: user.id, gameId: legacy.id, platform: "psn", playtimeMin: 0, unlockedCount: 3, completedAt: at(300) },
        { userId: user.id, gameId: steam.id, platform: "steam", playtimeMin: 60, unlockedCount: 3, completedAt: at(301) },
      ],
    });

    // What the ledger pays: settleListXp on every list game and platform, plus the Steam 100%.
    const lists = await prisma.trophyList.findMany({
      where: { progress: { some: { userId: user.id } } },
      select: { gameId: true, platform: true },
    });
    for (const platform of LIST_PLATFORMS) {
      const ids = [...lists.filter((l) => l.platform === platform).map((l) => l.gameId), ...(platform === "psn" ? [legacy.id] : [])];
      await prisma.$transaction((tx) => settleListXp(tx, user.id, platform, ids, at(400)));
    }
    const entries = await prisma.xpLedgerEntry.findMany({
      where: { userId: user.id, source: { in: ["achievement", "platinum"] }, voidedAt: null },
      select: { source: true, sourceKey: true },
    });
    // Lists whose catalog rows have a platinum trophy (their bonus is not a platinum of its own).
    const platinumRows = await prisma.achievement.findMany({
      where: { trophyTier: "platinum", game: { slug: { startsWith: PREFIX } } },
      select: { id: true, gameId: true, list: { select: { platform: true, console: true, externalId: true } } },
    });
    // A platinum trophy paid: one achievement entry per valid unlock (keyed by a platinum row).
    const trophies = entries.filter((x) => x.source === "achievement" && platinumRows.some((r) => r.id === x.sourceKey)).length;
    // A platinum bonus of a list without a platinum trophy: "psn:<console>:<gameId>" (the version's
    // canonical list), "<platform>:<externalId>:<gameId>", legacy "<platform>:<gameId>".
    const withTrophy = (sourceKey: string) => {
      const [platform, middle, gameId] = sourceKey.split(":");
      return platinumRows.some(
        (r) => r.gameId === gameId && r.list && r.list.platform === platform && (r.list.externalId === middle || versionKey(r.list) === `${platform}:${middle}`),
      );
    };
    const bonuses = entries.filter((x) => x.source === "platinum" && !withTrophy(x.sourceKey)).length;
    const steamCompletions = 1;

    const { platinums, psnPlatinums } = await platinumTally(user.id);
    expect(platinums).toBe(trophies + bonuses + steamCompletions);
    // Misto 3, DLC 1, Suspeito 1, Halo 2, SNES 1, Legado 1, Steam 1.
    expect(platinums).toBe(10);
    // The platinum trophies (Misto's two PS5 regions and DLC), as Sony counts them.
    expect(psnPlatinums).toBe(3);
  });
});
