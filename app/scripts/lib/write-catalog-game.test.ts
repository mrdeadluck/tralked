import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import type { StoreApp } from "@/lib/integrations/steam/store";
import type { CatalogGameInput, CatalogMedia } from "./write-catalog-game";

// Needs Postgres up (see src/lib/db.test.ts); skipped when unreachable.
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

const APP_BASE = 96_000_000;
const USER_STEAM_ID = "test-writer-1";
const CDN = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";

const store = (appId: number, overrides: Partial<StoreApp> = {}): StoreApp => ({
  appId,
  type: "game",
  name: `Writer Test ${appId}`,
  summary: "Resumo da loja.",
  developer: "Studio",
  publisher: "Publisher",
  releaseDate: new Date(Date.UTC(2020, 0, 2)),
  comingSoon: false,
  criticScore: 80,
  achievementCount: 2,
  headerUrl: `${CDN}/${appId}/header.jpg`,
  screenshots: [],
  trailers: [],
  ...overrides,
});

const media = (appId: number): CatalogMedia[] => [
  { kind: "cover", order: 0, url: `${CDN}/${appId}/library_600x900.jpg`, width: 600, height: 900 },
  { kind: "screenshot", order: 0, url: `${CDN}/${appId}/ss_a.1920x1080.jpg`, width: 1920, height: 1080 },
  { kind: "screenshot", order: 1, url: `${CDN}/${appId}/ss_b.jpg` },
  // Not on Steam's CDN over https: never stored.
  { kind: "screenshot", order: 2, url: "http://evil.example/ss.jpg" },
];

const input = (appId: number, overrides: Partial<CatalogGameInput> = {}): CatalogGameInput => ({
  appId,
  store: store(appId),
  schema: [
    { apiName: "CHARMED", name: "Charmed", description: "First charm", iconUrl: "https://shared.fastly.steamstatic.com/community_assets/images/apps/1/c.jpg", hidden: false },
    { apiName: "FK_DEFEAT", name: "Falsehood", iconUrl: "javascript:alert(1)", hidden: false },
  ],
  percentages: { CHARMED: 76.7, FK_DEFEAT: 71.3 },
  skills: ["soulslike", "plataforma"],
  media: media(appId),
  ...overrides,
});

describe.skipIf(!reachable)("writeCatalogGame", () => {
  async function cleanup() {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { steamId: USER_STEAM_ID } });
    await prisma.game.deleteMany({ where: { steamAppId: { gte: APP_BASE, lt: APP_BASE + 100 } } });
  }

  async function snapshot(appId: number) {
    const { prisma } = await import("@/lib/db");
    return prisma.game.findUniqueOrThrow({
      where: { steamAppId: appId },
      include: {
        achievements: { orderBy: { apiName: "asc" } },
        media: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
        skills: { orderBy: { skill: "asc" } },
        platformLinks: true,
      },
    });
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("creates the game with achievements, rarity, CDN-only media, skills and its Steam link; a re-run changes nothing", async () => {
    const { writeCatalogGame } = await import("./write-catalog-game");
    const appId = APP_BASE + 1;

    const first = await writeCatalogGame(input(appId));
    expect(first.created).toBe(true);
    const created = await snapshot(appId);
    expect(created).toMatchObject({
      slug: `writer-test-${appId}`,
      name: `Writer Test ${appId}`,
      summary: "Resumo da loja.",
      coverUrl: `${CDN}/${appId}/library_600x900.jpg`,
      achievementCount: 2,
      platforms: ["PC"],
    });
    expect(created.achievements.map((a) => [a.apiName, a.globalPct, a.iconUrl !== null])).toEqual([
      ["CHARMED", 76.7, true],
      ["FK_DEFEAT", 71.3, false],
    ]);
    expect(created.media.map((m) => `${m.kind}:${m.order}`)).toEqual(["cover:0", "screenshot:0", "screenshot:1"]);
    expect(created.media.every((m) => m.source === "steam")).toBe(true);
    expect(created.skills.map((s) => s.skill)).toEqual(["plataforma", "soulslike"]);
    expect(created.platformLinks).toEqual([{ gameId: created.id, platform: "steam", externalId: String(appId) }]);

    const second = await writeCatalogGame(input(appId));
    expect(second.created).toBe(false);
    const again = await snapshot(appId);
    const ids = (g: typeof created) => ({
      achievements: g.achievements.map((a) => a.id),
      media: g.media.map((m) => m.id),
      skills: g.skills.map((s) => s.skill),
      links: g.platformLinks.length,
    });
    expect(ids(again)).toEqual(ids(created));
    expect(again.achievements).toEqual(created.achievements);
  });

  it("completes a seeded game: blanks only, seed rows re-keyed by unique name (unlocks kept), manual skills kept", async () => {
    const { prisma } = await import("@/lib/db");
    const { writeCatalogGame } = await import("./write-catalog-game");
    const appId = APP_BASE + 2;
    const seeded = await prisma.game.create({
      data: {
        slug: `seeded-${appId}`,
        name: "Seeded Name",
        summary: "Texto editorial.",
        steamAppId: appId,
        platforms: ["PLAYSTATION"],
        achievementCount: 9,
        skills: { create: [{ skill: "rpg" }] },
        achievements: {
          create: [
            { platform: "steam", apiName: "FIXTURE_CHARMED", name: "charmed" },
            { platform: "steam", apiName: "ONLY_SEED", name: "Only in the seed" },
            // Two rows share a name: ambiguous, so neither is re-keyed.
            { platform: "steam", apiName: "DUP_1", name: "Twin" },
            { platform: "steam", apiName: "DUP_2", name: "Twin" },
          ],
        },
      },
      include: { achievements: true },
    });
    const fixtureCharmed = seeded.achievements.find((a) => a.apiName === "FIXTURE_CHARMED")!;
    const user = await prisma.user.create({
      data: { steamId: USER_STEAM_ID, handle: "test_writer_1", displayName: "Writer" },
    });
    await prisma.userAchievement.create({
      data: { userId: user.id, achievementId: fixtureCharmed.id, unlockedAt: new Date("2021-01-01T00:00:00Z") },
    });

    const schema = [
      ...input(appId).schema,
      { apiName: "TWIN", name: "Twin", hidden: false },
    ];
    const { created } = await writeCatalogGame(input(appId, { schema, skills: ["soulslike"] }));

    expect(created).toBe(false);
    const game = await snapshot(appId);
    // Blanks filled, editorial fields and slug kept; PC added to the platforms.
    expect(game).toMatchObject({
      slug: `seeded-${appId}`,
      name: "Seeded Name",
      summary: "Texto editorial.",
      developer: "Studio",
      coverUrl: `${CDN}/${appId}/library_600x900.jpg`,
      achievementCount: 3,
      platforms: ["PLAYSTATION", "PC"],
    });
    // The seed row became Steam's CHARMED (same id, unlock kept, fields refreshed).
    const charmed = game.achievements.find((a) => a.apiName === "CHARMED")!;
    expect(charmed.id).toBe(fixtureCharmed.id);
    expect(charmed).toMatchObject({ name: "Charmed", globalPct: 76.7 });
    expect(await prisma.userAchievement.count({ where: { achievementId: charmed.id } })).toBe(1);
    expect(game.achievements.map((a) => a.apiName)).toEqual(["CHARMED", "DUP_1", "DUP_2", "FK_DEFEAT", "ONLY_SEED", "TWIN"]);
    // Skills are only set while the game has none: the manual one stays alone.
    expect(game.skills.map((s) => s.skill)).toEqual(["rpg"]);
  });
});
