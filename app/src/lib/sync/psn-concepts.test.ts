import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PsnPlayedGame } from "@/lib/integrations/psn/types";
import { env } from "@/lib/env";

// Needs Postgres up and migrated (see db.test.ts); skipped when unreachable.
async function databaseReachable(): Promise<boolean> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 1500 });
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
const HANDLE_PREFIX = "test_concepts_";
const SLUG_PREFIX = "test-concepts-";
const LIST_PREFIX = "NPWRCONCEPTTEST_";

describe.skipIf(!reachable)("mapNewTitles", () => {
  let counter = 0;
  const accounts: string[] = [];

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    const { conceptMemoryKey } = await import("./psn-concepts");
    await prisma.syncCursor.deleteMany({ where: { key: { in: accounts.map(conceptMemoryKey) } } });
    await prisma.user.deleteMany({ where: { handle: { startsWith: HANDLE_PREFIX } } });
    await prisma.game.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  }

  async function linked() {
    const { prisma } = await import("@/lib/db");
    counter++;
    const user = await prisma.user.create({
      data: {
        handle: `${HANDLE_PREFIX}${counter}`,
        displayName: "Teste",
        linkedAccounts: {
          create: { platform: "psn", externalId: `test-concepts-${counter}`, handle: "Conceito", linkedAt: new Date() },
        },
      },
      include: { linkedAccounts: true },
    });
    const account = user.linkedAccounts[0];
    accounts.push(account.id);
    return account;
  }

  const played = (titleId: string, conceptId: number | null, lastPlayed: number, conceptTitleIds = [titleId]): PsnPlayedGame => ({
    titleId,
    name: `Jogo ${titleId}`,
    category: "ps5_native_game",
    playtimeMin: 60,
    firstPlayedAt: null,
    lastPlayedAt: new Date(Date.UTC(2026, 0, 1) + lastPlayed * 3_600_000),
    conceptId,
    conceptTitleIds,
    conceptName: null,
  });

  /** Spies the PSN fixture: every title id has one list `${LIST_PREFIX}<titleId>` unless `lists` says otherwise. */
  async function spyLists(lists: Record<string, string[]> = {}) {
    const { getPsn } = await import("@/lib/integrations");
    return vi
      .spyOn(getPsn(), "getTrophyListsOfTitles")
      .mockImplementation(async (_account, ids) => new Map(ids.map((id) => [id, lists[id] ?? [`${LIST_PREFIX}${id}`]])));
  }

  const askedIds = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.flatMap((c) => c[1] as string[]);

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("at most 50 new title ids are mapped per sync", async () => {
    const { prisma } = await import("@/lib/db");
    const { mapNewTitles, conceptMemoryKey } = await import("./psn-concepts");
    const account = await linked();
    const games = Array.from({ length: 60 }, (_, i) => played(`PPSA${String(i).padStart(5, "0")}_00`, 1000 + i, i));
    const spy = await spyLists();
    try {
      const first = await mapNewTitles(account.externalId, account.id, games);
      // The most recently played first.
      const recent = games.slice(10).map((g) => g.titleId);
      expect(askedIds(spy).sort()).toEqual([...recent].sort());
      expect(first.size).toBe(50);
      expect(first.get(`${LIST_PREFIX}PPSA00059_00`)).toBe(1059);
      const memory = await prisma.syncCursor.findUniqueOrThrow({ where: { key: conceptMemoryKey(account.id) } });
      expect(memory.value).toMatchObject({ externalId: account.externalId, linkedAt: account.linkedAt!.toISOString() });
      expect(((memory.value as { mapped: string[] }).mapped).sort()).toEqual([...recent].sort());

      spy.mockClear();
      const second = await mapNewTitles(account.externalId, account.id, games);
      expect(askedIds(spy).sort()).toEqual(games.slice(0, 10).map((g) => g.titleId).sort());
      // What earlier syncs learned comes back too (a list read in a later run keeps its concept).
      expect(second.size).toBe(60);
      expect(second.get(`${LIST_PREFIX}PPSA00000_00`)).toBe(1000);
      expect(second.get(`${LIST_PREFIX}PPSA00059_00`)).toBe(1059);

      spy.mockClear();
      const third = await mapNewTitles(account.externalId, account.id, games);
      expect(spy).not.toHaveBeenCalled();
      expect(third).toEqual(second);
      const lists = (await prisma.syncCursor.findUniqueOrThrow({ where: { key: conceptMemoryKey(account.id) } })).value as {
        lists: Record<string, number>;
      };
      expect(Object.keys(lists.lists)).toHaveLength(60);
    } finally {
      spy.mockRestore();
    }
  });

  it("a relink starts the memory over", async () => {
    const { prisma } = await import("@/lib/db");
    const { mapNewTitles } = await import("./psn-concepts");
    const account = await linked();
    const games = [played("PPSA90100_00", 77, 1)];
    const spy = await spyLists();
    try {
      await mapNewTitles(account.externalId, account.id, games);
      await mapNewTitles(account.externalId, account.id, games);
      expect(spy).toHaveBeenCalledTimes(1);
      await prisma.linkedAccount.update({ where: { id: account.id }, data: { linkedAt: new Date(Date.now() + 1000) } });
      // The learned lists are forgotten with the ids: nothing comes back before asking again.
      spy.mockResolvedValueOnce(new Map());
      expect((await mapNewTitles(account.externalId, account.id, games)).size).toBe(0);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("only one-list title ids of one concept give a concept; titles without a concept are not asked", async () => {
    const { mapNewTitles } = await import("./psn-concepts");
    const account = await linked();
    const games = [
      played("PPSA90201_00", 10, 1),
      // A collection: one store title, two trophy lists (two games): no concept for either.
      played("PPSA90202_00", 20, 2),
      // One list reached from two concepts: ambiguous.
      played("PPSA90203_00", 30, 3),
      played("PPSA90204_00", 40, 4),
      played("PPSA90205_00", null, 5),
    ];
    const spy = await spyLists({
      PPSA90202_00: ["NPWRCOLLECTION_A", "NPWRCOLLECTION_B"],
      PPSA90203_00: ["NPWRSHARED"],
      PPSA90204_00: ["NPWRSHARED"],
    });
    try {
      const mapped = await mapNewTitles(account.externalId, account.id, games);
      expect(mapped).toEqual(new Map([[`${LIST_PREFIX}PPSA90201_00`, 10]]));
      expect(askedIds(spy)).not.toContain("PPSA90205_00");
    } finally {
      spy.mockRestore();
    }
  });

  it("a passed deadline asks nothing; only the ids answered are remembered", async () => {
    const { prisma } = await import("@/lib/db");
    const { mapNewTitles, conceptMemoryKey } = await import("./psn-concepts");
    const account = await linked();
    const games = Array.from({ length: 10 }, (_, i) => played(`PPSA905${String(i).padStart(2, "0")}_00`, 500 + i, i));
    const spy = await spyLists();
    try {
      expect((await mapNewTitles(account.externalId, account.id, games, 50, Date.now() - 1)).size).toBe(0);
      expect(spy).not.toHaveBeenCalled();
      expect(await prisma.syncCursor.findUnique({ where: { key: conceptMemoryKey(account.id) } })).toBeNull();

      // The client stopped after one batch (deadline): the five ids not asked are asked next time.
      const deadline = Date.now() + 60_000;
      spy.mockImplementationOnce(async (_account, ids, options) => {
        expect(options?.deadline).toBe(deadline);
        return new Map(ids.slice(0, 5).map((id) => [id, [`${LIST_PREFIX}${id}`]]));
      });
      expect((await mapNewTitles(account.externalId, account.id, games, 50, deadline)).size).toBe(5);
      spy.mockClear();
      expect((await mapNewTitles(account.externalId, account.id, games)).size).toBe(10);
      expect(askedIds(spy).sort()).toEqual(games.slice(0, 5).map((g) => g.titleId).sort());
    } finally {
      spy.mockRestore();
    }
  });

  it("a list a later sync finds under another concept is dropped (ambiguous)", async () => {
    const { mapNewTitles } = await import("./psn-concepts");
    const account = await linked();
    const spy = await spyLists({ PPSA90601_00: ["NPWRAMBIGUOUS"], PPSA90602_00: ["NPWRAMBIGUOUS"] });
    try {
      expect(await mapNewTitles(account.externalId, account.id, [played("PPSA90601_00", 61, 1)])).toEqual(
        new Map([["NPWRAMBIGUOUS", 61]]),
      );
      const later = await mapNewTitles(account.externalId, account.id, [played("PPSA90601_00", 61, 1), played("PPSA90602_00", 62, 2)]);
      expect(later.has("NPWRAMBIGUOUS")).toBe(false);
      spy.mockClear();
      expect((await mapNewTitles(account.externalId, account.id, [played("PPSA90601_00", 61, 1)])).has("NPWRAMBIGUOUS")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("stored lists of a mapped title get their concept (only while they have none)", async () => {
    const { prisma } = await import("@/lib/db");
    const { mapNewTitles } = await import("./psn-concepts");
    const account = await linked();
    const game = await prisma.game.create({ data: { slug: `${SLUG_PREFIX}${counter}`, name: "Conceito Teste", achievementCount: 0 } });
    const list = (externalId: string, conceptId: number | null) =>
      prisma.trophyList.create({ data: { gameId: game.id, platform: "psn", externalId, name: "Conceito Teste", console: "PS5", conceptId } });
    await list(`${LIST_PREFIX}PPSA90301_00`, null);
    await list(`${LIST_PREFIX}PPSA90302_00`, 999);
    const spy = await spyLists();
    try {
      await mapNewTitles(account.externalId, account.id, [played("PPSA90301_00", 301, 1), played("PPSA90302_00", 302, 2)]);
    } finally {
      spy.mockRestore();
    }
    const lists = await prisma.trophyList.findMany({ where: { gameId: game.id }, orderBy: { externalId: "asc" } });
    expect(lists.map((l) => l.conceptId)).toEqual([301, 999]);
  });

  it("nothing is mapped for an account that is not the linked one", async () => {
    const { mapNewTitles } = await import("./psn-concepts");
    const account = await linked();
    const spy = await spyLists();
    try {
      expect((await mapNewTitles("another-account", account.id, [played("PPSA90401_00", 1, 1)])).size).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
