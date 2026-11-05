import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getPsn } from "@/lib/integrations";
import { busyImports, holdImportLease, importKey, releaseImportLease } from "@/lib/sync/import-lease";
import { finishTrophyLists, type FinishOptions } from "./finish";

// Test database only (vitest.db-guard.ts). Uses the PSN fixture account `Tres-Consoles` (Grand
// Theft Auto V with a PS3, a PS4 and a PS5 list) on a game set up as the backfill (A9) leaves a
// multi-list game: three empty TrophyList rows and the old list-less rows holding the unlocks.
// Fixtures use the `test-fin` prefix; every run is scoped to the fixture user and game.
const PREFIX = "test-fin";
const ACCOUNT = "9000000000000000005";
const XBOX_ACCOUNT = "2535400000000002";
const GTA_LISTS = ["NPWR90011_00", "NPWR90012_00", "NPWR90013_00"];
let n = 0;
/** No real waiting in tests (the 60 s cron wait). */
const run = (options: FinishOptions) => finishTrophyLists({ sleep: async () => {}, ...options });

async function cleanup() {
  await releaseImportLease();
  const games = await prisma.game.findMany({
    where: {
      OR: [
        { slug: { startsWith: PREFIX } },
        { platformLinks: { some: { platform: "psn", externalId: { in: GTA_LISTS } } } },
        { trophyLists: { some: { platform: "psn", externalId: { in: GTA_LISTS } } } },
      ],
    },
    select: { id: true },
  });
  await prisma.game.deleteMany({ where: { id: { in: games.map((g) => g.id) } } });
  await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  // The fixture accounts are shared with other suites: free them.
  await prisma.linkedAccount.deleteMany({ where: { platform: "psn", externalId: ACCOUNT } });
  await prisma.linkedAccount.deleteMany({ where: { platform: "xbox", externalId: XBOX_ACCOUNT } });
  // The Xbox fixture's title the seeded catalog does not have (created by a sync).
  await prisma.game.deleteMany({ where: { platformLinks: { some: { platform: "xbox", externalId: "90000005" } } } });
}

/** A user with the fixture account and GTA V collapsed as before trophy lists (46 list-less unlocks). */
async function collapsedGta() {
  const i = ++n;
  const user = await prisma.user.create({
    data: {
      handle: `${PREFIX}-${i}`,
      displayName: "Teste",
      linkedAccounts: { create: { platform: "psn", externalId: ACCOUNT, handle: "Tres-Consoles", verifiedAt: new Date() } },
    },
  });
  const game = await prisma.game.create({
    data: { slug: `${PREFIX}-gta-${i}`, name: "Grand Theft Auto V", achievementCount: 0, platforms: [] },
  });
  const lists = [];
  for (const [k, externalId] of GTA_LISTS.entries()) {
    await prisma.gamePlatformLink.create({ data: { gameId: game.id, platform: "psn", externalId } });
    lists.push(
      await prisma.trophyList.create({
        data: {
          gameId: game.id,
          platform: "psn",
          externalId,
          name: "Grand Theft Auto V",
          createdAt: new Date(Date.UTC(2026, 10, 5, 0, k)),
        },
      }),
    );
  }
  await prisma.achievement.createMany({
    data: Array.from({ length: 77 }, (_, k) => ({
      gameId: game.id,
      platform: "psn",
      apiName: String(k + 1),
      name: `Troféu ${k + 1}`,
      trophyTier: k === 0 ? "platinum" : "bronze",
    })),
  });
  const listless = await prisma.achievement.findMany({ where: { gameId: game.id, listId: null } });
  const byApi = new Map(listless.map((a) => [a.apiName, a]));
  await prisma.userAchievement.createMany({
    data: Array.from({ length: 46 }, (_, k) => ({
      userId: user.id,
      achievementId: byApi.get(String(k + 2))!.id,
      unlockedAt: new Date(Date.UTC(2015, 1, 1 + k)),
    })),
  });
  await prisma.userGame.create({ data: { userId: user.id, gameId: game.id, platform: "psn", playtimeMin: 0, unlockedCount: 46 } });
  return { user, game, lists, byApi };
}

async function guideOf(gameId: string) {
  return prisma.guide.create({
    data: {
      gameId,
      status: "draft",
      version: "1",
      difficulty: 3,
      hoursMin: 1,
      hoursMax: 2,
      playthroughs: "1",
      missables: 0,
      online: 0,
      overview: [],
      warnings: [],
    },
  });
}

const note = (guideId: string, achievementId: string, tip: string) =>
  prisma.guideAchievementNote.create({ data: { guideId, achievementId, category: "historia", tip, steps: [] } });

beforeEach(cleanup);
afterAll(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe("finishTrophyLists", () => {
  it("finish moves guide notes before deleting collapsed rows", async () => {
    const { user, game, lists, byApi } = await collapsedGta();
    const guide = await guideOf(game.id);
    // The canonical list (oldest: the PS3 one) already has trophy 6, with its own note in the guide.
    const own6 = await prisma.achievement.create({
      data: { gameId: game.id, platform: "psn", listId: lists[0].id, apiName: "6", name: "Troféu 6" },
    });
    await note(guide.id, own6.id, "existing");
    const n5 = await note(guide.id, byApi.get("5")!.id, "five");
    // The PS3 list has 59 trophies: trophy 70 is only in the PS4 and PS5 lists (the PS4 one is older).
    const n70 = await note(guide.id, byApi.get("70")!.id, "seventy");
    await note(guide.id, byApi.get("6")!.id, "old six");

    const report = await run({ users: [user.id], gameIds: [game.id] });

    expect(report.accounts).toEqual([
      expect.objectContaining({ userId: user.id, platform: "psn", outcome: "done", failedTitles: [] }),
    ]);
    expect(report.notes).toEqual({ moved: 2, replacedByExisting: 1, withoutTarget: 0 });
    expect(report.deleted).toEqual({ achievements: 77, unlocks: 46 });
    expect(report.kept).toEqual([]);
    expect(await prisma.achievement.count({ where: { gameId: game.id, listId: null } })).toBe(0);

    const target5 = await prisma.achievement.findUniqueOrThrow({ where: { listId_apiName: { listId: lists[0].id, apiName: "5" } } });
    const target70 = await prisma.achievement.findUniqueOrThrow({ where: { listId_apiName: { listId: lists[1].id, apiName: "70" } } });
    expect((await prisma.guideAchievementNote.findUniqueOrThrow({ where: { id: n5.id } })).achievementId).toBe(target5.id);
    expect((await prisma.guideAchievementNote.findUniqueOrThrow({ where: { id: n70.id } })).achievementId).toBe(target70.id);
    const notes = await prisma.guideAchievementNote.findMany({ where: { guideId: guide.id }, orderBy: { tip: "asc" } });
    expect(notes.map((x) => x.tip)).toEqual(["existing", "five", "seventy"]);

    // The lists hold every unlock once: 20 + 46 + 26.
    expect(await prisma.userAchievement.count({ where: { userId: user.id, achievement: { gameId: game.id } } })).toBe(92);
    expect(report.after.find((u) => u.userId === user.id)).toMatchObject({ psnUnlocks: 92 });
    expect(report.before.find((u) => u.userId === user.id)).toMatchObject({ psnUnlocks: 46 });
    // XP rebuilt from the lists: one valid entry per trophy of each version.
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement", voidedAt: null } })).toBe(92);
    expect(report.rebuilt.map((r) => r.userId)).toEqual([user.id]);
    expect(await busyImports()).toEqual(new Set());
  });

  it("finish skips an account the cron holds", async () => {
    const { user, game } = await collapsedGta();
    const held = importKey("psn", user.id);
    await holdImportLease([held]);

    const report = await run({ users: [user.id], gameIds: [game.id] });

    expect(report.accounts).toEqual([expect.objectContaining({ userId: user.id, platform: "psn", outcome: "busy", passes: 0 })]);
    expect(report.kept).toEqual([expect.stringMatching(new RegExp(`^kept: ${game.slug} psn .*busy`))]);
    expect(report.deleted).toEqual({ achievements: 0, unlocks: 0 });
    expect(await prisma.achievement.count({ where: { gameId: game.id, listId: null } })).toBe(77);
    expect(await prisma.achievement.count({ where: { gameId: game.id, listId: { not: null } } })).toBe(0);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(46);
    // The worker's reservation is left as it was.
    expect(await busyImports()).toEqual(new Set([held]));
  });

  it("dry run reports without writing", async () => {
    const { user, game, byApi } = await collapsedGta();
    const guide = await guideOf(game.id);
    await note(guide.id, byApi.get("5")!.id, "five");
    const ledgerBefore = await prisma.xpLedgerEntry.count({ where: { userId: user.id } });

    const report = await run({ dryRun: true, users: [user.id], gameIds: [game.id] });

    expect(report.dryRun).toBe(true);
    expect(report.accounts).toEqual([]);
    expect(report.games).toEqual([
      expect.objectContaining({ gameId: game.id, slug: game.slug, platform: "psn", rows: 77, unlocks: 46, notes: 1, action: "would-delete" }),
    ]);
    // The lists have no rows yet (the resync writes them): the note has no target now.
    expect(report.notes).toEqual({ moved: 0, replacedByExisting: 0, withoutTarget: 1 });
    expect(report.deleted).toEqual({ achievements: 0, unlocks: 0 });
    expect(report.rebuilt).toEqual([]);
    expect(report.before).toEqual(report.after);
    expect(report.before).toEqual([expect.objectContaining({ userId: user.id, psnUnlocks: 46, steamUnlocks: 0, steamXp: 0 })]);

    expect(await prisma.achievement.count({ where: { gameId: game.id } })).toBe(77);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(46);
    expect(await prisma.userTrophyList.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(ledgerBefore);
    expect((await prisma.linkedAccount.findFirstOrThrow({ where: { userId: user.id } })).lastSyncAttemptAt).toBeNull();
    expect(await busyImports()).toEqual(new Set());
  });

  it("a resync cut short continues in later passes without reading the same lists again", async () => {
    const { user, game } = await collapsedGta();
    const trophies = vi.spyOn(getPsn(), "getTrophies");
    try {
      const report = await run({ users: [user.id], gameIds: [game.id], maxTitlesPerPass: 1 });
      expect(report.accounts).toEqual([expect.objectContaining({ outcome: "done", passes: 3 })]);
      expect(trophies.mock.calls.map((c) => c[1]).sort()).toEqual(GTA_LISTS);
      expect(report.deleted.achievements).toBe(77);
    } finally {
      trophies.mockRestore();
    }
  });

  it("a resync still partial after the last pass keeps the rows", async () => {
    const { user, game } = await collapsedGta();
    const report = await run({ users: [user.id], gameIds: [game.id], maxTitlesPerPass: 1, maxPasses: 2 });
    expect(report.accounts).toEqual([expect.objectContaining({ outcome: "partial", passes: 2 })]);
    expect(report.kept).toEqual([expect.stringMatching(new RegExp(`^kept: ${game.slug} psn .*partial`))]);
    expect(await prisma.achievement.count({ where: { gameId: game.id, listId: null } })).toBe(77);
  });

  it("a platform left out of the resync keeps its rows", async () => {
    const { user, game } = await collapsedGta();
    const report = await run({ users: [user.id], gameIds: [game.id], platforms: ["xbox"] });
    expect(report.accounts).toEqual([]);
    expect(report.kept).toEqual([`kept: ${game.slug} psn psn was not resynced (no credential)`]);
    expect(await prisma.achievement.count({ where: { gameId: game.id, listId: null } })).toBe(77);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(46);
  });

  it("a list that failed to read keeps the game's rows", async () => {
    const { user, game } = await collapsedGta();
    const psn = getPsn();
    const real = psn.getTrophies.bind(psn);
    const trophies = vi.spyOn(psn, "getTrophies").mockImplementation(async (account, id, service) => {
      if (id === "NPWR90012_00") throw new Error("PSN title trophies failed with HTTP 500");
      return real(account, id, service);
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const report = await run({ users: [user.id], gameIds: [game.id] });
      // The failed list is tried once more, alone.
      expect(report.accounts).toEqual([expect.objectContaining({ outcome: "done", passes: 2, failedTitles: ["NPWR90012_00"] })]);
      expect(trophies.mock.calls.map((c) => c[1]).filter((id) => id === "NPWR90012_00")).toHaveLength(2);
      expect(report.kept).toEqual([expect.stringMatching(new RegExp(`^kept: ${game.slug} psn .*NPWR90012_00`))]);
      expect(await prisma.achievement.count({ where: { gameId: game.id, listId: null } })).toBe(77);
    } finally {
      logged.mockRestore();
      trophies.mockRestore();
    }
  });
  it("unlocks no list row holds keep the game's rows", async () => {
    const { user, game } = await collapsedGta();
    // Sony no longer lists the PS4 list (hidden): unlocks 22-47 (beyond the PS3 and PS5 lists) are on no list row.
    const psn = getPsn();
    const real = psn.getTitles.bind(psn);
    const titles = vi.spyOn(psn, "getTitles").mockImplementation(async (account) => {
      const all = await real(account);
      return all === "private" ? all : all.filter((t) => t.npTitleId !== "NPWR90012_00");
    });
    try {
      const report = await run({ users: [user.id], gameIds: [game.id] });
      expect(report.accounts).toEqual([expect.objectContaining({ outcome: "done", failedTitles: [] })]);
      expect(report.kept).toEqual([`kept: ${game.slug} psn ${user.handle}: 20 unlocks not on a list`]);
      expect(await prisma.achievement.count({ where: { gameId: game.id, listId: null } })).toBe(77);
    } finally {
      titles.mockRestore();
    }
  });

  it("the valid ledger entries of deleted rows are voided", async () => {
    const { user, game, byApi } = await collapsedGta();
    // Another user's entry on a list-less row he no longer holds: once the row is gone, no settle finds it.
    const other = await prisma.user.create({ data: { handle: `${PREFIX}-other-${++n}`, displayName: "Outro" } });
    const entry = await prisma.xpLedgerEntry.create({
      data: { userId: other.id, source: "achievement", sourceKey: byApi.get("60")!.id, xp: 50, platform: "psn", skills: [] },
    });
    const report = await run({ users: [user.id, other.id], gameIds: [game.id] });
    expect(report.deleted.achievements).toBe(77);
    expect((await prisma.xpLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).voidedAt).not.toBeNull();
  });

  it("waits once for a cron run already in flight before the first resync", async () => {
    const { user, game } = await collapsedGta();
    const sleep = vi.fn(async () => {});
    const trophies = vi.spyOn(getPsn(), "getTrophies");
    const order: string[] = [];
    sleep.mockImplementation(async () => {
      order.push(`sleep:${trophies.mock.calls.length}`);
    });
    try {
      await finishTrophyLists({ users: [user.id], gameIds: [game.id], sleep });
      expect(sleep.mock.calls).toEqual([[60_000]]);
      expect(order).toEqual(["sleep:0"]);
    } finally {
      trophies.mockRestore();
    }
  });

  it("puts its keys back in the lease before each account when the worker rewrote it", async () => {
    const { user, game } = await collapsedGta();
    await prisma.linkedAccount.create({
      data: { userId: user.id, platform: "xbox", externalId: XBOX_ACCOUNT, handle: "Tralked Teste", verifiedAt: new Date() },
    });
    const { getXbox } = await import("@/lib/integrations");
    const psn = getPsn();
    const xbox = getXbox();
    const realPsn = psn.getTitles.bind(psn);
    const realXbox = xbox.getTitles.bind(xbox);
    let seen: Set<string> | null = null;
    // The import worker ends its run while the PSN resync reads: it wipes the lease.
    const psnTitles = vi.spyOn(psn, "getTitles").mockImplementation(async (account) => {
      await releaseImportLease();
      return realPsn(account);
    });
    const xboxTitles = vi.spyOn(xbox, "getTitles").mockImplementation(async (account) => {
      seen = await busyImports();
      return realXbox(account);
    });
    try {
      const report = await run({ users: [user.id], gameIds: [game.id] });
      expect(report.accounts.map((a) => [a.platform, a.outcome])).toEqual([
        ["psn", "done"],
        ["xbox", "done"],
      ]);
      expect(seen).toEqual(new Set([importKey("psn", user.id), importKey("xbox", user.id)]));
      expect(await busyImports()).toEqual(new Set());
    } finally {
      psnTitles.mockRestore();
      xboxTitles.mockRestore();
    }
  });
});
