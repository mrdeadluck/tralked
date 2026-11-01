import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

// Needs Postgres up and seeded (see db.test.ts); skipped when unreachable.
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

const PREFIX = "test_char_";
const MARK = "char-test";

describe.skipIf(!reachable)("character sheet v2", () => {
  let counter = 0;

  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.photo.deleteMany({ where: { caption: { contains: MARK } } });
    await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  }

  async function newUser(data: { lastSyncedAt?: Date; level?: number } = {}) {
    const { prisma } = await import("@/lib/db");
    counter++;
    return prisma.user.create({
      data: {
        handle: `${PREFIX}${counter}`,
        displayName: "Teste",
        lastSyncedAt: data.lastSyncedAt ?? null,
        ...(data.level && { stats: { create: { totalXp: 0, level: data.level, vocation: "Recruta" } } }),
      },
    });
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  describe("Despertar", () => {
    it("plays once after the first sync, then never again", async () => {
      const { pendingDespertar, markDespertarShown } = await import("./despertar");
      const user = await newUser({ lastSyncedAt: new Date(), level: 5 });

      expect(await pendingDespertar(user.id)).toEqual([2, 3, 4, 5]);
      // Two tabs racing: only the first records it.
      const marks = await Promise.all([markDespertarShown(user.id), markDespertarShown(user.id)]);
      expect(marks.filter(Boolean)).toHaveLength(1);
      expect(await pendingDespertar(user.id)).toBeNull();
    });

    it("waits for the first sync and for something to climb", async () => {
      const { prisma } = await import("@/lib/db");
      const { pendingDespertar } = await import("./despertar");

      const neverSynced = await newUser({ level: 9 });
      expect(await pendingDespertar(neverSynced.id)).toBeNull();

      // A synced linked account counts as a sync too (Google reader with PSN, no Steam).
      await prisma.linkedAccount.create({
        data: { userId: neverSynced.id, platform: "psn", externalId: `psn-${neverSynced.id}`, handle: "x", verifiedAt: new Date() },
      });
      expect(await pendingDespertar(neverSynced.id)).toBeNull();
      await prisma.linkedAccount.updateMany({ where: { userId: neverSynced.id }, data: { lastSyncedAt: new Date() } });
      expect(await pendingDespertar(neverSynced.id)).toHaveLength(8);

      const levelOne = await newUser({ lastSyncedAt: new Date(), level: 1 });
      expect(await pendingDespertar(levelOne.id)).toBeNull();
      expect(await pendingDespertar("no-such-user")).toBeNull();
    });
  });

  it("reads attributes, verified platforms, trophies and visible photos", async () => {
    const { prisma } = await import("@/lib/db");
    const { getCharacterSheetExtras } = await import("./sheet");
    const user = await newUser({ lastSyncedAt: new Date() });
    await prisma.user.update({ where: { id: user.id }, data: { bio: "Caçador de platinas" } });
    await prisma.attributeProgress.createMany({
      data: [
        { userId: user.id, attribute: "vigor", level: 3, points: 138 },
        { userId: user.id, attribute: "gloria", level: 2, points: 60 },
      ],
    });
    await prisma.linkedAccount.createMany({
      data: [
        { userId: user.id, platform: "xbox", externalId: `xbox-${user.id}`, handle: "gt", verifiedAt: new Date() },
        // Typed in without proof: connected, shown as not verified.
        { userId: user.id, platform: "retro", externalId: `retro-${user.id}`, handle: "ra" },
        // Pending claim: not a connected platform.
        { userId: user.id, platform: "psn", externalId: `pending:${user.id}`, handle: "psn", verifyCode: "TRK-AAAAAA", linkedAt: null },
      ],
    });
    const achievement = await prisma.achievement.findFirstOrThrow({
      where: { platform: "psn", trophyTier: "gold" },
    });
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: achievement.id, unlockedAt: new Date() } });
    await prisma.photo.createMany({
      data: [
        { authorId: user.id, width: 10, height: 10, caption: `visível ${MARK}` },
        { authorId: user.id, width: 10, height: 10, caption: `oculta ${MARK}`, status: "hidden" },
      ],
    });

    const extras = await getCharacterSheetExtras(user.id);
    expect(extras.bio).toBe("Caçador de platinas");
    expect(extras.attributes.map((a) => a.id)).toEqual([
      "vigor",
      "precisao",
      "gloria",
      "colecao",
      "exploracao",
      "constancia",
      "sabedoria",
      "resistencia",
      "acervo",
      "carisma",
    ]);
    expect(extras.attributes[0]).toMatchObject({ level: 3, points: 138, current: 38, span: 125, source: "horas jogadas" });
    expect(extras.attributes[1]).toMatchObject({ level: 1, points: 0 });
    expect(extras.platforms).toEqual([
      { platform: "xbox", handle: "gt", verified: true },
      { platform: "retro", handle: "ra", verified: false },
    ]);
    expect(extras.trophies.tiers).toEqual({ platinum: 0, gold: 1, silver: 0, bronze: 0 });
    expect(extras.trophies.byPlatform).toEqual([{ platform: "psn", unlocks: 1 }]);
    expect(extras.photos.total).toBe(1);
    expect(extras.photos.items.map((p) => p.caption)).toEqual([`visível ${MARK}`]);
    expect(extras.steamSyncFailing).toBe(false);
  });
});
