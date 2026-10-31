import { afterAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import {
  bestProgress,
  buildGameNewsTabs,
  platformProgress,
  playableVideos,
  rankSimilar,
  safeMediaUrl,
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

describe("game profile helpers", () => {
  it("only lets http(s) and same-site media URLs through", () => {
    expect(safeMediaUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(safeMediaUrl("/uploads/x.webp")).toBe("/uploads/x.webp");
    expect(safeMediaUrl("javascript:alert(1)")).toBeNull();
    expect(safeMediaUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeMediaUrl("//evil.example.com/x.js")).toBeNull();
    expect(safeMediaUrl(null)).toBeNull();
  });

  it("keeps playable videos only: files over http(s) and valid YouTube ids", () => {
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
      "https://img.example.com/hero.jpg",
    );
    expect(videos).toEqual([
      { id: "a", kind: "file", url: "https://video.example.com/t.webm", poster: "https://img.example.com/hero.jpg", title: "Trailer", source: "Steam" },
      { id: "b", kind: "youtube", youtubeId: "dQw4w9WgXcQ", title: "Vídeo 2", source: "YouTube via IGDB" },
    ]);
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
      featured: 0,
      likes: 0,
      comments: 0,
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
    expect(p.achievements.byPlatform).toEqual([
      { platform: "steam", total: 63 },
      { platform: "psn", total: 8 },
      { platform: "xbox", total: 7 },
    ]);
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
    expect(p.timeTo100).toEqual({ minutes: 4800, players: 1 });
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
    expect(me!.family?.map((f) => f.handle)).toContain("LunaDeFerro");
  });

  it("a user without the game gets no progress but still the opened flag and family", async () => {
    const { prisma } = await import("@/lib/db");
    const { getGameProfileForUser } = await import("./game-profile");
    const kairo = await prisma.user.findUniqueOrThrow({ where: { handle: "KairoBR" } });
    const me = await getGameProfileForUser("hollow-knight", kairo.id);
    expect(me).toMatchObject({ opened: false, progress: null, trophies: null, attributes: null });
    expect(me!.family?.some((f) => f.handle === "lucas")).toBe(true);
  });
});
