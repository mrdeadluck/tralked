import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import {
  backdropVideo,
  bestProgress,
  buildGameNewsTabs,
  catalogPlatforms,
  completionSample,
  discLabelArt,
  mainPlatform,
  platformProgress,
  playableVideos,
  rankSimilar,
  safeMediaUrl,
  splitByPlatform,
  steamMovieId,
} from "./game-profile";

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

describe("the game's numbers (one source per figure)", () => {
  // Hollow Knight shape: 63 on Steam (only 3 rows read), 4 PSN trophies with a platinum, 1 Xbox.
  const rows = [
    { platform: "steam", globalPct: 2, trophyTier: null },
    { platform: "steam", globalPct: 15, trophyTier: null },
    { platform: "steam", globalPct: 60, trophyTier: null },
    { platform: "psn", globalPct: null, trophyTier: "platinum" },
    { platform: "psn", globalPct: null, trophyTier: "gold" },
    { platform: "psn", globalPct: null, trophyTier: "bronze" },
    { platform: "psn", globalPct: null, trophyTier: "bronze" },
    { platform: "xbox", globalPct: 40, trophyTier: null },
  ];

  it("keeps each platform's tiers apart, adding up to that platform's own total", () => {
    const list = catalogPlatforms(rows, 63);
    expect(list.map((p) => [p.platform, p.total])).toEqual([
      ["steam", 63],
      ["psn", 4],
      ["xbox", 1],
    ]);
    const [steam, psn, xbox] = list;
    // Steam: the 60 rows not read yet have no known rarity, so they count as bronze.
    expect(steam.tiers).toEqual({ platinum: 1, gold: 1, silver: 1, bronze: 61 });
    expect(steam.nativePlatinum).toBe(false);
    expect(steam.legendary).toBe(1);
    expect(psn.tiers).toEqual({ platinum: 1, gold: 1, silver: 0, bronze: 2 });
    expect(psn.nativePlatinum).toBe(true);
    expect(xbox.tiers).toEqual({ platinum: 1, gold: 0, silver: 0, bronze: 1 });
    expect(mainPlatform(list)?.platform).toBe("steam");
    expect(mainPlatform(catalogPlatforms(rows.filter((r) => r.platform === "psn"), 0))?.platform).toBe("psn");
    expect(mainPlatform(catalogPlatforms([], 0))).toBeNull();
  });

  it("a logged-out sample is this game's own 100%, and none without achievements", () => {
    const main = mainPlatform(catalogPlatforms(rows, 3))!;
    const sample = completionSample(main, rows, 50 * 60, "soulslike", 2)!;
    expect(sample.hours).toBe(50);
    expect(sample.rareCount).toBe(1);
    expect(sample.precisao).toBe(30);
    expect(sample.colecao).toBe(250);
    expect(sample.skill).toMatchObject({ id: "soulslike", name: "Soulslike" });
    // Another game gives other numbers: nothing is a fixed illustration.
    const other = completionSample(mainPlatform(catalogPlatforms(rows.slice(2, 3), 1))!, rows.slice(2, 3), null, null)!;
    expect(other.xp).toBeLessThan(sample.xp);
    expect(other.vigor).toBe(0);
    expect(completionSample(null, [], 600, null)).toBeNull();
  });
});

describe("game profile helpers", () => {
  it("only lets https and same-site media URLs through", () => {
    expect(safeMediaUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(safeMediaUrl("/uploads/x.webp")).toBe("/uploads/x.webp");
    expect(safeMediaUrl("javascript:alert(1)")).toBeNull();
    expect(safeMediaUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeMediaUrl("//evil.example.com/x.js")).toBeNull();
    expect(safeMediaUrl("/\\evil.example.com/x.js")).toBeNull();
    expect(safeMediaUrl("http://cdn.example.com/a.jpg")).toBeNull();
    // Control characters and backslashes anywhere (browsers strip or rewrite them).
    expect(safeMediaUrl("/\t/evil.example.com/x.js")).toBeNull();
    expect(safeMediaUrl("/uploads/a\nb.webp")).toBeNull();
    expect(safeMediaUrl("/uploads/..\\..\\x.webp")).toBeNull();
    expect(safeMediaUrl("https://cdn.example.com/a b.jpg")).toBeNull();
    expect(safeMediaUrl("https://cdn.example.com/a\u0000.jpg")).toBeNull();
    expect(safeMediaUrl(null)).toBeNull();
  });

  it("keeps playable videos only: files over https and valid YouTube ids", () => {
    const row = { kind: "video", source: "steam", order: 0 };
    const videos = playableVideos(
      [
        { ...row, id: "a", url: "https://video.example.com/t.webm", youtubeId: null },
        { ...row, id: "b", url: null, youtubeId: "dQw4w9WgXcQ", source: "igdb" },
        { ...row, id: "c", url: null, youtubeId: "bad id<script>" },
        { ...row, id: "d", url: "javascript:alert(1)", youtubeId: null },
        { ...row, id: "e", url: null, youtubeId: null, source: "fixture" },
        { ...row, id: "f", kind: "screenshot", url: "https://x.example.com/s.jpg", youtubeId: null },
      ],
      ["https://img.example.com/s9.jpg"],
    );
    expect(videos).toEqual([
      { id: "a", kind: "file", url: "https://video.example.com/t.webm", thumbnail: "https://img.example.com/s9.jpg", title: "Trailer", source: "Steam" },
      {
        id: "b",
        kind: "youtube",
        youtubeId: "dQw4w9WgXcQ",
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        title: "Vídeo 2",
        source: "YouTube via IGDB",
      },
    ]);
  });

  it("gives every video its own thumbnail: Steam's still of that trailer, never one shared picture", () => {
    const row = { kind: "video", source: "steam", youtubeId: null };
    const videos = playableVideos(
      [
        { ...row, id: "a", order: 0, url: "https://video.akamai.steamstatic.com/store_trailers/256889456/movie_max.mp4" },
        { ...row, id: "b", order: 1, url: "https://cdn.akamai.steamstatic.com/steam/apps/256679401/movie480.mp4?t=1" },
        { ...row, id: "c", order: 2, url: "https://video.example.com/one.mp4" },
        { ...row, id: "d", order: 3, url: "https://video.example.com/two.mp4" },
        { ...row, id: "e", order: 4, url: "https://video.example.com/three.mp4" },
      ],
      ["https://img.example.com/s3.jpg", "https://img.example.com/s2.jpg"],
    );
    expect(videos.map((v) => v.thumbnail)).toEqual([
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256889456/movie.293x165.jpg",
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256679401/movie.293x165.jpg",
      "https://img.example.com/s3.jpg",
      "https://img.example.com/s2.jpg",
      null, // no picture of its own left: the tile draws its own generated art
    ]);
  });

  it("disc label: a screenshot, else the logo over the art's colour, else generated; never the cover or hero", () => {
    const art = { cover: "https://c.example.com/cover.jpg", hero: "https://c.example.com/hero.jpg", logo: "https://c.example.com/logo.png" };
    const media = (kind: string, url: string | null, order = 0) => ({ id: `${kind}${order}`, kind, url, youtubeId: null, source: "steam", order });
    expect(discLabelArt([media("screenshot", "https://c.example.com/s2.jpg", 2), media("screenshot", "https://c.example.com/s1.jpg", 1)], art)).toEqual({
      kind: "shot",
      url: "https://c.example.com/s1.jpg",
    });
    // A "screenshot" that is the cover or the hero is skipped; generated fixtures (url null) too.
    expect(discLabelArt([media("screenshot", art.cover), media("screenshot", art.hero, 1), media("screenshot", null, 2)], art)).toEqual({
      kind: "logo",
      url: art.logo,
      tintFrom: art.cover,
    });
    expect(discLabelArt([media("cover", art.cover), media("hero", art.hero)], { ...art, logo: null })).toEqual({ kind: "generated" });
  });

  it("background loop: Steam's lighter 480p file first (full size as fallback), else YouTube, else none", () => {
    const row = { kind: "video", source: "steam", youtubeId: null };
    expect(
      backdropVideo([
        { ...row, id: "y", order: 0, url: null, youtubeId: "dQw4w9WgXcQ", source: "igdb" },
        { ...row, id: "s", order: 1, url: "https://video.akamai.steamstatic.com/store_trailers/256889456/movie_max.mp4" },
      ]),
    ).toEqual({
      kind: "file",
      sources: [
        "https://video.akamai.steamstatic.com/store_trailers/256889456/movie480.mp4",
        "https://video.akamai.steamstatic.com/store_trailers/256889456/movie_max.mp4",
      ],
      poster: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/256889456/movie.293x165.jpg",
    });
    expect(backdropVideo([{ ...row, id: "y", order: 0, url: null, youtubeId: "dQw4w9WgXcQ" }])).toEqual({ kind: "youtube", youtubeId: "dQw4w9WgXcQ" });
    expect(backdropVideo([{ ...row, id: "x", order: 0, url: "javascript:alert(1)" }, { ...row, id: "f", order: 1, url: null, source: "fixture" }])).toBeNull();
    expect(steamMovieId("https://evil.example.com/store_trailers/1/movie_max.mp4")).toBeNull();
  });

  it("platform progress: 100% only when complete, best platform prefers a completed one", () => {
    const steam = platformProgress({ platform: "steam", unlockedCount: 62, playtimeMin: 100, completedAt: null }, 63);
    const psn = platformProgress({ platform: "psn", unlockedCount: 8, playtimeMin: 50, completedAt: new Date() }, 8);
    const xbox = platformProgress({ platform: "xbox", unlockedCount: 3, playtimeMin: -5, completedAt: null }, 7);
    expect(steam.pct).toBe(98);
    expect(platformProgress({ platform: "steam", unlockedCount: 199, playtimeMin: 0, completedAt: null }, 200).pct).toBe(99);
    expect(xbox).toMatchObject({ pct: 43, playtimeMin: 0, completed: false });
    expect(bestProgress([steam, xbox, psn])?.platform).toBe("psn");
    expect(bestProgress([xbox, steam])?.platform).toBe("steam");
    expect(bestProgress([])).toBeNull();
  });

  it("splits trophies by platform: native platinum on PSN, 100% as platinum elsewhere, all pooled", () => {
    const steam = platformProgress({ platform: "steam", unlockedCount: 3, playtimeMin: 0, completedAt: null }, 3);
    const psn = platformProgress({ platform: "psn", unlockedCount: 2, playtimeMin: 0, completedAt: null }, 4);
    const xbox = platformProgress({ platform: "xbox", unlockedCount: 0, playtimeMin: 0, completedAt: null }, 5);
    const { byPlatform, combined } = splitByPlatform(
      [steam, psn, xbox],
      [
        { platform: "steam", tier: "gold" },
        { platform: "steam", tier: "bronze" },
        { platform: "steam", tier: "bronze" },
        { platform: "psn", tier: "platinum" },
        { platform: "psn", tier: "silver" },
        // A platform without a library row: pooled only.
        { platform: "retro", tier: "bronze" },
      ],
    );
    expect(byPlatform.map((p) => [p.platform, p.trophies, p.platinumTrophy])).toEqual([
      ["steam", { platinum: 1, gold: 1, silver: 0, bronze: 2, platinumOf: 1 }, false],
      ["psn", { platinum: 1, gold: 0, silver: 1, bronze: 0, platinumOf: 1 }, true],
      ["xbox", { platinum: 0, gold: 0, silver: 0, bronze: 0, platinumOf: 1 }, false],
    ]);
    expect(combined).toEqual({
      unlocked: 5,
      total: 12,
      pct: 42,
      completed: false,
      trophies: { platinum: 2, gold: 1, silver: 1, bronze: 3, platinumOf: 3 },
    });
    expect(splitByPlatform([steam], []).combined).toMatchObject({ pct: 100, completed: true });
    expect(splitByPlatform([], []).combined).toMatchObject({ unlocked: 0, total: 0, pct: 0, completed: false });
  });

  it("ranks similar games by shared genres, ignoring the guides skill", () => {
    const ranked = rankSimilar(["soulslike", "plataforma", "sabio"], [
      { name: "Celeste", skills: ["plataforma"] },
      { name: "Elden Ring", skills: ["soulslike", "rpg"] },
      { name: "Silksong", skills: ["soulslike", "plataforma"] },
      { name: "Doom", skills: ["fps"] },
      { name: "Guia", skills: ["sabio"] },
    ]);
    expect(ranked.map((g) => [g.name, g.match])).toEqual([
      ["Silksong", 100],
      ["Celeste", 50],
      ["Elden Ring", 33],
    ]);
  });

  it("news tabs: everything in Últimas by date, a tab per category with stories, press last", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const article = (id: string, category: "GUIAS" | "GAMES", day: number) => ({
      id,
      slug: id,
      title: id,
      subtitle: null,
      excerpt: null,
      category,
      platforms: [],
      imageLabel: "",
      imageUrl: null,
      authorHandle: "lucas",
      authorLabel: "@lucas",
      bot: false,
      featured: 0,
      likes: 0,
      comments: 0,
      views: 0,
      humanAuthored: true,
      publishedAt: new Date(`2026-10-${day}T12:00:00Z`),
      game: { slug: "hollow-knight", name: "Hollow Knight" },
    });
    const press = { id: "x1", title: "Imprensa", url: "https://news.example.com/1", source: "Ex", publishedAt: new Date("2026-10-29T12:00:00Z"), game: null };
    const tabs = buildGameNewsTabs([article("g1", "GUIAS", 30), article("n1", "GAMES", 20)], [press], now, null);
    expect(tabs.map((t) => t.id)).toEqual(["ultimas", "games", "guias", "imprensa"]);
    expect(tabs[0].stories.map((s) => s.id)).toEqual(["g1", "x:x1", "n1"]);
    expect(tabs[3].stories[0]).toMatchObject({ external: true, href: "https://news.example.com/1" });
  });
});

const reachable = await databaseReachable();

describe.skipIf(!reachable)("game profile (seeded database)", () => {
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect();
  });

  it("loads the public profile with per-platform totals, media, news, gallery and similar games", async () => {
    const { loadGameProfile } = await import("./game-profile");
    const profile = await loadGameProfile("hollow-knight");
    expect(profile).not.toBeNull();
    const p = profile!;
    expect(p.name).toBe("Hollow Knight");
    expect(p.achievements.byPlatform.map(({ platform, total }) => ({ platform, total }))).toEqual([
      { platform: "steam", total: 63 },
      { platform: "psn", total: 8 },
      { platform: "xbox", total: 7 },
    ]);
    // The page headlines one platform; its tiers add up to its own total, never the sum of all.
    expect(p.achievements.main?.platform).toBe("steam");
    for (const pl of p.achievements.byPlatform) {
      const native = pl.nativePlatinum ? pl.tiers.platinum : 0;
      expect(pl.tiers.gold + pl.tiers.silver + pl.tiers.bronze + native).toBe(pl.total);
    }
    expect(p.sample?.colecao).toBe(250);
    // Seed fixtures have no file: no playable video, generated art for the images.
    expect(p.videos).toEqual([]);
    expect(p.shots).toHaveLength(6);
    expect(p.shots.every((s) => s.url === null)).toBe(true);
    expect(p.news.count).toBeGreaterThan(0);
    expect(p.news.tabs[0].id).toBe("ultimas");
    expect(p.gallery.photos.length).toBeLessThanOrEqual(9);
    expect(p.gallery.photos.every((photo) => photo.game?.slug === "hollow-knight")).toBe(true);
    expect(p.similar.map((g) => g.slug)).toContain("celeste");
    expect(p.similar.map((g) => g.slug)).not.toContain("hollow-knight");
    // lucas completed it on PSN in 80 h: the Tralked time to 100%.
    expect(p.timeTo100).toEqual({ minutes: 4800, source: "tralked", players: 1 });
  });

  it("once a game has real images, the generated placeholders are left out", async () => {
    const { prisma } = await import("@/lib/db");
    const { loadGameProfile } = await import("./game-profile");
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const real = await prisma.gameMedia.create({
      data: { gameId: game.id, kind: "screenshot", source: "steam", url: "https://cdn.example.com/shot.jpg", order: 9 },
    });
    try {
      const p = (await loadGameProfile("hollow-knight"))!;
      expect(p.shots.map((s) => s.url)).toEqual(["https://cdn.example.com/shot.jpg"]);
    } finally {
      await prisma.gameMedia.delete({ where: { id: real.id } });
    }
  });

  it("public photo listings leave out players with a private profile", async () => {
    const { prisma } = await import("@/lib/db");
    const { listPhotos, galleryGames } = await import("@/lib/community/gallery");
    const { loadGameProfile } = await import("./game-profile");
    const handle = "test-private-photo";
    await prisma.photo.deleteMany({ where: { author: { handle } } });
    await prisma.user.deleteMany({ where: { handle } });
    const user = await prisma.user.create({ data: { handle, displayName: "Privado", profilePublic: false } });
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: "celeste" } });
    const countOf = async () => (await galleryGames()).find((g) => g.slug === "celeste")!.photoCount;
    const before = await countOf();
    const photo = await prisma.photo.create({ data: { authorId: user.id, gameId: game.id, width: 800, height: 600 } });
    try {
      expect((await listPhotos({ gameSlug: "celeste" })).photos.map((p) => p.id)).not.toContain(photo.id);
      expect((await loadGameProfile("celeste"))!.gallery.photos.map((p) => p.id)).not.toContain(photo.id);
      expect(await countOf()).toBe(before);

      await prisma.user.update({ where: { id: user.id }, data: { profilePublic: true } });
      expect((await listPhotos({ gameSlug: "celeste" })).photos.map((p) => p.id)).toContain(photo.id);
      expect(await countOf()).toBe(before + 1);
    } finally {
      await prisma.photo.delete({ where: { id: photo.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("returns null for an unknown game", async () => {
    const { loadGameProfile, getGameProfileForUser } = await import("./game-profile");
    expect(await loadGameProfile("jogo-que-nao-existe")).toBeNull();
    expect(await getGameProfileForUser("jogo-que-nao-existe", "nobody")).toBeNull();
  });

  it("consolidates the user's progress across Steam, PSN and Xbox", async () => {
    const { prisma } = await import("@/lib/db");
    const { getGameProfileForUser } = await import("./game-profile");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const game = await prisma.game.findUniqueOrThrow({ where: { slug: "hollow-knight" } });
    const me = await getGameProfileForUser("hollow-knight", lucas.id);
    expect(me).not.toBeNull();

    const rows = await prisma.userGame.findMany({ where: { userId: lucas.id, gameId: game.id } });
    expect(me!.progress!.platforms.map((p) => p.platform)).toEqual(["steam", "psn", "xbox"]);
    expect(me!.progress!.playtimeMin).toBe(rows.reduce((acc, r) => acc + r.playtimeMin, 0));
    // The PSN list is complete (platinum), so the game counts as complete and PSN is the headline.
    expect(me!.progress!.completed).toBe(true);
    expect(me!.progress!.best).toMatchObject({ platform: "psn", unlocked: 8, total: 8, pct: 100 });
    expect(me!.progress!.platforms.find((p) => p.platform === "steam")).toMatchObject({ unlocked: 58, total: 63, pct: 92 });

    // Trophies pool every valid unlock of every platform; PSN has its native platinum.
    const unlocks = await prisma.userAchievement.count({
      where: { userId: lucas.id, suspicious: false, achievement: { gameId: game.id } },
    });
    const t = me!.trophies!;
    expect(t.gold + t.silver + t.bronze + t.platinum).toBe(unlocks);
    expect(t.platinum).toBe(1);
    expect(t.platinumOf).toBe(3);

    const a = me!.attributes!;
    expect(a.completed).toBe(true);
    expect(a.colecao).toBe(250);
    expect(a.hours).toBe(Math.round((3120 + 4800 + 540) / 60));
    expect(a.vigor).toBeGreaterThan(0);
    expect(a.gloria).toBeGreaterThanOrEqual(150); // at least the platinum (15 x 10)
    expect(a.skill?.id).toBe("soulslike");

    // Family: lucas first, then the other public members who played it.
    expect(me!.family?.[0]).toMatchObject({ handle: "lucas", me: true, pct: 100 });
    expect(me!.family?.map((f) => f.handle)).toContain("Herbalista_Rosa");
  });

  it("splits the user's progress by platform for the game page tabs and the player's view", async () => {
    const { prisma } = await import("@/lib/db");
    const { getGameProfileForUser, getPlayerGamePlatforms } = await import("./game-profile");
    const lucas = await prisma.user.findUniqueOrThrow({ where: { handle: "lucas" } });
    const me = await getGameProfileForUser("hollow-knight", lucas.id);
    const progress = me!.progress!;
    expect(progress.byPlatform.map((p) => p.platform)).toEqual(["steam", "psn", "xbox"]);
    expect(progress.byPlatform.find((p) => p.platform === "psn")).toMatchObject({ completed: true, platinumTrophy: true });
    // The pooled trophies are the platforms' trophies added up.
    const sum = (tier: "platinum" | "gold" | "silver" | "bronze") =>
      progress.byPlatform.reduce((acc, p) => acc + p.trophies[tier], 0);
    expect(me!.trophies).toMatchObject({ platinum: sum("platinum"), gold: sum("gold"), silver: sum("silver"), bronze: sum("bronze") });
    expect(progress.combined.unlocked).toBe(progress.platforms.reduce((acc, p) => acc + p.unlocked, 0));

    const view = await getPlayerGamePlatforms("hollow-knight", lucas.id);
    expect(view).toMatchObject({ slug: "hollow-knight", best: "psn", combined: progress.combined });
    expect(view!.byPlatform).toEqual(progress.byPlatform);
    expect(await getPlayerGamePlatforms("jogo-que-nao-existe", lucas.id)).toBeNull();
    const kairo = await prisma.user.findUniqueOrThrow({ where: { handle: "Cacador_Joaquim" } });
    expect(await getPlayerGamePlatforms("hollow-knight", kairo.id)).toBeNull();
  });

  it("a user without the game gets no progress but still the opened flag and family", async () => {
    const { prisma } = await import("@/lib/db");
    const { getGameProfileForUser } = await import("./game-profile");
    const kairo = await prisma.user.findUniqueOrThrow({ where: { handle: "Cacador_Joaquim" } });
    const me = await getGameProfileForUser("hollow-knight", kairo.id);
    expect(me).toMatchObject({ opened: false, progress: null, trophies: null, attributes: null });
    expect(me!.family?.some((f) => f.handle === "lucas")).toBe(true);
  });
});
