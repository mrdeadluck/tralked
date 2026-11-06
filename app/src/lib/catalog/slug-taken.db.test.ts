import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SteamApi } from "@/lib/integrations";
import { prisma } from "@/lib/db";

// Test database only (vitest.db-guard.ts). Every game creator must treat an old URL of a joined
// game (GameSlugRedirect.fromSlug) as taken: a new game on it would shadow the redirect.
const PREFIX = "test-slt";
const APP = 97_500_000;
const IGDB = 97_500_000;
const RA = 97_500;

const integrations = vi.hoisted(() => ({ igdbByName: null as null | { igdbId: number; name: string } }));
vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  const steam: Partial<SteamApi> = {
    getSchemaForGame: async () => [{ apiName: "A0", name: "A0", hidden: false }],
    getGlobalAchievementPercentages: async () => ({ A0: 10 }),
  };
  return {
    ...actual,
    getSteam: () => steam as SteamApi,
    getIgdb: () => ({ findBySteamAppId: async () => null, findByName: async () => integrations.igdbByName }),
    getRawg: () => ({ findBySteamAppId: async () => null }),
    getSgdb: () => ({ getArt: async () => ({}) }),
  };
});

let counter = 0;
const next = () => `${PREFIX}-${++counter}`;

async function cleanup() {
  await prisma.gameSlugRedirect.deleteMany({ where: { fromSlug: { startsWith: PREFIX } } });
  await prisma.retroCatalogGame.deleteMany({ where: { id: { gte: RA, lt: RA + 100 } } });
  await prisma.game.deleteMany({
    where: {
      OR: [
        { slug: { startsWith: PREFIX } },
        { slug: { contains: `${APP}` } },
        { steamAppId: { gte: APP, lt: APP + 100 } },
      ],
    },
  });
}

beforeAll(cleanup);
afterAll(cleanup);

/** A redirect on `slug` (an old URL of a joined game), leading to some game. */
async function redirect(slug: string) {
  const target = await prisma.game.create({ data: { slug: next(), name: "Test Slt Alvo", achievementCount: 0, platforms: [] } });
  await prisma.gameSlugRedirect.create({ data: { fromSlug: slug, gameId: target.id } });
  return target;
}

describe("a new game never takes the slug of a redirect", () => {
  it("Steam stubs (ensureSteamGames)", async () => {
    const { ensureSteamGames } = await import("@/lib/sync/steam-games");
    const old = next();
    await redirect(old);
    const ids = await ensureSteamGames([{ appId: APP + 1, name: old.replace(/-/g, " ") }]);
    const game = await prisma.game.findUniqueOrThrow({ where: { id: ids.get(APP + 1)! } });
    expect(game.slug).toBe(`${old}-${APP + 1}`);
  });

  it("a placeholder slug replaced by the real name (slugAfterPlaceholder)", async () => {
    const { slugAfterPlaceholder, placeholderSteamName, steamSlugBase } = await import("@/lib/sync/steam-games");
    const appId = APP + 2;
    const game = await prisma.game.create({
      data: { slug: steamSlugBase(placeholderSteamName(appId), appId), name: placeholderSteamName(appId), steamAppId: appId, achievementCount: 0, platforms: ["PC"] },
    });
    const old = next();
    await redirect(old);
    const slug = await prisma.$transaction((tx) => slugAfterPlaceholder(tx, game, old.replace(/-/g, " "), appId));
    expect(slug).toEqual({ slug: `${old}-${appId}` });
  });

  it("the Steam catalog sync (syncGame)", async () => {
    const { syncGame } = await import("@/lib/sync/catalog");
    const { placeholderSteamName, steamSlugBase } = await import("@/lib/sync/steam-games");
    const appId = APP + 3;
    const base = steamSlugBase(placeholderSteamName(appId), appId);
    await redirect(base);
    const game = await syncGame(appId);
    expect(game?.slug).toBe(`${base}-${appId}`);
  });

  it("the Steam details writer (writeCatalogGame)", async () => {
    const { writeCatalogGame } = await import("@/lib/sync/write-catalog-game");
    const appId = APP + 4;
    const old = next();
    await redirect(old);
    const { game } = await writeCatalogGame({
      appId,
      store: { appId, type: "game", name: old.replace(/-/g, " "), comingSoon: false, achievementCount: 0, screenshots: [], trailers: [] },
      schema: [],
      percentages: {},
      skills: [],
      media: [],
    });
    expect(game.slug).toBe(`${old}-${appId}`);
  });

  it("a platform title (resolvePlatformGame)", async () => {
    const { resolvePlatformGame } = await import("@/lib/sync/platform-games");
    const old = next();
    await redirect(old);
    const id = await resolvePlatformGame("psn", { externalId: "NPWR97500-00", name: old.replace(/-/g, " "), platformLabel: "PS4" }, new Map(), { igdb: false });
    const game = await prisma.game.findUniqueOrThrow({ where: { id } });
    expect(game.slug).not.toBe(old);
    expect(game.slug.startsWith(old)).toBe(true);
  });

  it("an RA catalog game (linkRetroCatalog)", async () => {
    const { linkRetroCatalog } = await import("@/lib/sync/retro-catalog");
    const old = next();
    await redirect(old);
    await prisma.retroCatalogGame.create({
      data: { id: RA + 1, title: old.replace(/-/g, " "), consoleId: 1, consoleName: "Mega Drive", achievementCount: 1, points: 1 },
    });
    await linkRetroCatalog();
    const link = await prisma.gamePlatformLink.findUniqueOrThrow({
      where: { platform_externalId: { platform: "retro", externalId: String(RA + 1) } },
      select: { game: { select: { slug: true } } },
    });
    expect(link.game.slug).toBe(`${old}-ra-${RA + 1}`);
  });
});

describe("a platform title whose IGDB game is an alias", () => {
  it("is linked to the game that has the alias, not created again", async () => {
    const { resolvePlatformGame } = await import("@/lib/sync/platform-games");
    const keep = await prisma.game.create({ data: { slug: next(), name: "Test Slt Fica", igdbId: IGDB + 1, achievementCount: 0, platforms: [] } });
    await prisma.gameIgdbAlias.create({ data: { igdbId: IGDB + 2, gameId: keep.id } });
    integrations.igdbByName = { igdbId: IGDB + 2, name: "Test Slt Edição Juntada" };
    try {
      const id = await resolvePlatformGame("xbox", { externalId: "975000002", name: "Test Slt Edição Juntada", platformLabel: "Xbox One" }, new Map());
      expect(id).toBe(keep.id);
    } finally {
      integrations.igdbByName = null;
    }
  });
});
