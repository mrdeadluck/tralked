import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import type { SteamApi } from "@/lib/integrations";

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

vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => (session.userId ? { id: session.userId } : null),
}));

const steamState = vi.hoisted(() => ({
  api: null as unknown as SteamApi,
  asked: [] as number[],
  unlocks: {} as Record<string, Date | null>,
  profilePublic: true,
  privateGame: false,
  /** Fresh playtime of the app (GetOwnedGames filtered to it); "fail" makes the call throw. */
  playtimeMin: 600 as number | "fail",
}));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  return {
    ...actual,
    getSteam: () => steamState.api,
    getIgdb: () => ({ findBySteamAppId: async () => null }),
    getRawg: () => ({ findBySteamAppId: async () => null }),
    getSgdb: () => ({ getArt: async () => ({}) }),
  };
});

const APP_ID = 97500001;
const PREFIX = "test-gcheck-";
const PCTS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`A${i}`, 10]));
const FIXTURE = "../ROBO NOTICIAS/test/guias/fixtures/walkthrough-pbz.json";

function installSteam() {
  steamState.asked = [];
  steamState.unlocks = {};
  steamState.privateGame = false;
  steamState.playtimeMin = 600;
  steamState.api = {
    async getPlayerSummary(steamId) {
      return { steamId, personaName: "Test", avatarUrl: "", profilePublic: steamState.profilePublic };
    },
    async getOwnedGames(_steamId, options) {
      if (options?.appId !== APP_ID) throw new Error("the single-game check must not read the library");
      if (steamState.playtimeMin === "fail") throw new Error("steam down");
      return [{ appId: APP_ID, playtimeMin: steamState.playtimeMin }];
    },
    async getSchemaForGame() {
      return Object.keys(PCTS).map((apiName) => ({ apiName, name: apiName, hidden: false }));
    },
    async getGlobalAchievementPercentages() {
      return { ...PCTS };
    },
    async getPlayerAchievements(_steamId, appId) {
      steamState.asked.push(appId);
      if (steamState.privateGame) return "private";
      return Object.keys(PCTS).map((apiName) => ({ apiName, unlockedAt: steamState.unlocks[apiName] ?? null }));
    },
    async getWishlist() {
      return [];
    },
    async getAppList() {
      return "unsupported";
    },
  };
}

describe.skipIf(!reachable)("single-game Steam check", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.syncCursor.deleteMany({ where: { key: { startsWith: "game-check:" } } });
    await prisma.user.deleteMany({
      where: { OR: [{ steamId: { startsWith: PREFIX } }, { handle: { startsWith: "test_gcheck_" } }] },
    });
    await prisma.game.deleteMany({ where: { steamAppId: APP_ID } });
  }

  async function newUser(steam = true) {
    const { prisma } = await import("@/lib/db");
    counter++;
    const user = await prisma.user.create({
      data: {
        ...(steam && { steamId: `${PREFIX}${counter}` }),
        handle: `test_gcheck_${counter}`,
        displayName: "Test gcheck",
        profilePublic: true,
      },
    });
    session.userId = user.id;
    return user;
  }

  async function gameId() {
    const { syncGame } = await import("./catalog");
    return (await syncGame(APP_ID))!.id;
  }

  const xpRows = async (userId: string) => {
    const { prisma } = await import("@/lib/db");
    return prisma.xpLedgerEntry.count({ where: { userId } });
  };

  beforeAll(async () => {
    installSteam();
    await cleanup();
  });
  beforeEach(() => {
    installSteam();
    session.userId = null;
  });
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("nova conquista do jogo vira UserAchievement e XpLedgerEntry", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const id = await gameId();
    const user = await newUser();
    steamState.unlocks = { A0: new Date("2024-01-02T10:00:00Z"), A1: new Date("2024-01-03T10:00:00Z") };

    const result = await checkGameAchievements(id);

    expect(result.status).toBe("ok");
    expect(result.newUnlocks.map((u) => u.apiName).sort()).toEqual(["A0", "A1"]);
    expect(result.reward?.xpGained).toBeGreaterThan(0);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement" } })).toBe(2);
  });

  it("não lê outros jogos da biblioteca", async () => {
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const id = await gameId();
    await newUser();
    steamState.unlocks = { A0: new Date("2024-01-02T10:00:00Z") };

    await checkGameAchievements(id);

    expect(steamState.asked).toEqual([APP_ID]);
  });

  it("sem Steam ligada → status unlinked, nenhuma linha de XP", async () => {
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const { syncUserGame } = await import("./user");
    const id = await gameId();
    const user = await newUser(false);

    expect(await syncUserGame(user.id, APP_ID)).toEqual({ status: "unlinked", newUnlocks: [] });
    expect(await checkGameAchievements(id)).toMatchObject({ status: "unlinked", reward: null });
    expect(await xpRows(user.id)).toBe(0);
    expect(steamState.asked).toEqual([]);
  });

  it("perfil privado → private", async () => {
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const id = await gameId();
    const user = await newUser();
    steamState.privateGame = true;

    expect(await checkGameAchievements(id)).toEqual({ status: "private", newUnlocks: [], reward: null });
    expect(await xpRows(user.id)).toBe(0);
  });

  it("segunda conferência em 10 s → cooldown", async () => {
    const { claimGameCheckSlot } = await import("./game-check");
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const user = await newUser();
    const t = new Date("2030-01-01T00:00:00Z");

    expect(await claimGameCheckSlot(user.id, t)).toBe(true);
    expect(await claimGameCheckSlot(user.id, new Date(t.getTime() + 10_000))).toBe(false);
    expect(await claimGameCheckSlot(user.id, new Date(t.getTime() + 16_000))).toBe(true);

    const id = await gameId();
    await newUser();
    expect((await checkGameAchievements(id)).status).toBe("ok");
    expect(await checkGameAchievements(id)).toEqual({ status: "cooldown", newUnlocks: [], reward: null });
  });

  it("unlock em rajada fica suspicious e sem XP", async () => {
    const { prisma } = await import("@/lib/db");
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const id = await gameId();
    const user = await newUser();
    const at = new Date("2024-05-05T20:00:00Z");
    steamState.unlocks = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`A${i}`, new Date(at.getTime() + i * 3000)]),
    );

    const result = await checkGameAchievements(id);

    expect(result.status).toBe("ok");
    expect(result.reward).toBeNull();
    expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(10);
    expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "achievement" } })).toBe(0);
  });

  it("logged out → unauthenticated", async () => {
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const id = await gameId();
    expect(await checkGameAchievements(id)).toEqual({ status: "unauthenticated", newUnlocks: [], reward: null });
  });

  it("an unexpected failure → error (not ok)", async () => {
    const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
    const id = await gameId();
    await newUser();
    const read = steamState.api.getPlayerAchievements;
    steamState.api.getPlayerAchievements = async () => {
      throw new Error("steam exploded");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkGameAchievements(id)).toEqual({ status: "error", newUnlocks: [], reward: null });
    log.mockRestore();
    steamState.api.getPlayerAchievements = read;
  });

  describe("completion (speed-platinum rule needs fresh playtime)", () => {
    const allUnlocked = () =>
      Object.fromEntries(Object.keys(PCTS).map((a, i) => [a, new Date(Date.UTC(2024, 0, 1 + i))]));

    async function completable() {
      const { prisma } = await import("@/lib/db");
      const id = await gameId();
      // Average completion of 100 h: the rule flags anything under 5 h.
      await prisma.game.update({ where: { id }, data: { timeToBeatCompleteMin: 6000 } });
      const user = await newUser();
      // Stored playtime is days old and below the threshold.
      await prisma.userGame.create({ data: { userId: user.id, gameId: id, platform: "steam", playtimeMin: 10, unlockedCount: 0 } });
      return { id, user, prisma };
    }

    it("stored playtime below the threshold but fresh playtime fine → not flagged", async () => {
      const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
      const { id, user, prisma } = await completable();
      steamState.unlocks = allUnlocked();
      steamState.playtimeMin = 6000;

      expect((await checkGameAchievements(id)).status).toBe("ok");
      expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(0);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id, source: "platinum" } })).toBe(1);
    });

    it("fresh playtime really below the threshold → flagged, no XP (same verdict as syncUser)", async () => {
      const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
      const { id, user, prisma } = await completable();
      steamState.unlocks = allUnlocked();
      steamState.playtimeMin = 60;

      await checkGameAchievements(id);
      expect(await prisma.userAchievement.count({ where: { userId: user.id, suspicious: true } })).toBe(12);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(0);
    });

    it("no fresh playtime → nothing recorded, status error", async () => {
      const { checkGameAchievements } = await import("@/app/jogos/[slug]/guia/actions");
      const { id, user, prisma } = await completable();
      steamState.unlocks = allUnlocked();
      steamState.playtimeMin = "fail";
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await checkGameAchievements(id)).toEqual({ status: "error", newUnlocks: [], reward: null });
      log.mockRestore();
      expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.xpLedgerEntry.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  describe("toggleItem", () => {
    async function publishedGuide() {
      const { prisma } = await import("@/lib/db");
      const id = await gameId();
      const walkthrough = JSON.parse(readFileSync(resolve(process.cwd(), FIXTURE), "utf8"));
      const guide = await prisma.guide.upsert({
        where: { gameId: id },
        create: {
          gameId: id,
          status: "published",
          version: "1",
          difficulty: 3,
          hoursMin: 10,
          hoursMax: 20,
          playthroughs: "1",
          missables: 0,
          online: 0,
          overview: [],
          warnings: [],
          format: 2,
          walkthrough,
        },
        update: { status: "published", format: 2, walkthrough },
      });
      return { guide, key: "sino-lady-rift" };
    }

    it("toggleItem com chave inexistente → not_found", async () => {
      const { toggleItem } = await import("@/app/jogos/[slug]/guia/actions");
      const { guide } = await publishedGuide();
      await newUser();
      expect(await toggleItem(guide.id, "nao-existe")).toEqual({ status: "not_found" });
    });

    it("toggleItem liga e desliga", async () => {
      const { prisma } = await import("@/lib/db");
      const { toggleItem } = await import("@/app/jogos/[slug]/guia/actions");
      const { guide, key } = await publishedGuide();
      const user = await newUser();
      expect(await toggleItem(guide.id, key)).toEqual({ status: "ok", done: true });
      expect(await prisma.guideItemProgress.count({ where: { userId: user.id, guideId: guide.id } })).toBe(1);
      expect(await toggleItem(guide.id, key)).toEqual({ status: "ok", done: false });
      expect(await prisma.guideItemProgress.count({ where: { userId: user.id, guideId: guide.id } })).toBe(0);
      expect(await xpRows(user.id)).toBe(0);
      session.userId = null;
      expect(await toggleItem(guide.id, key)).toEqual({ status: "unauthenticated" });
    });
  });
});
