import { prisma } from "@/lib/db";
import { BIG_RELEASE_HEAT, releaseHeat } from "@/lib/releases/heat";
import { RELEASE_PLATFORMS, RELEASE_PLATFORM_LABEL, type ReleasePlatform } from "@/lib/releases/platforms";
import { dayKey, instantBounds, monthParam, utcBounds, utcDayKey, type Month } from "./month";

/**
 * What the calendar shows on each day (Plano 4, F8). Public layer: published articles and game
 * releases (GameRelease rows, and the catalog's own release dates of listed games). Personal layer
 * (the signed-in player, or another player whose profile is public): achievements unlocked (one
 * entry per game and day), hours milestones paid in XP and missions completed. Each layer is a
 * handful of queries bounded by the visible month, all on indexed columns.
 */

export type CalendarEventKind = "article" | "release" | "unlock" | "playtime" | "mission";

export type CalendarEvent = {
  kind: CalendarEventKind;
  /** "2026-10-31" (Brasília day; release dates as stored). */
  day: string;
  title: string;
  /** Short context: category, platforms, rarest achievement… */
  detail: string | null;
  href: string | null;
  /** Sort weight inside a day (higher first). Releases: their heat (lib/releases/heat.ts). */
  weight: number;
  /** Releases: the game's portrait cover, when the catalog has one. */
  imageUrl?: string | null;
  /** Releases: a big launch (drawn heavier). */
  big?: boolean;
};

export const EVENT_KIND_LABEL: Record<CalendarEventKind, string> = {
  release: "Lançamento",
  article: "Matéria",
  unlock: "Conquistas",
  playtime: "Marco de horas",
  mission: "Missão",
};

/** Most releases of a month the calendar lists (the most popular / most played first). */
const MONTH_RELEASE_LIMIT = 400;
const MONTH_ARTICLE_LIMIT = 300;

const CATEGORY_LABEL: Record<string, string> = {
  GAMES: "Games",
  GUIAS: "Guias",
  COMUNIDADE: "Comunidade",
  MERCADO: "Mercado",
  ENTRETENIMENTO: "Entretenimento",
  TECNOLOGIA: "Tecnologia",
};

const platformsText = (platforms: string[]) =>
  RELEASE_PLATFORMS.filter((p) => platforms.includes(p))
    .map((p) => RELEASE_PLATFORM_LABEL[p])
    .join(", ") || null;

export function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) map.set(e.day, [...(map.get(e.day) ?? []), e]);
  const order: Record<CalendarEventKind, number> = { release: 0, article: 1, mission: 2, playtime: 3, unlock: 4 };
  for (const list of map.values()) list.sort((a, b) => order[a.kind] - order[b.kind] || b.weight - a.weight);
  return map;
}

/** The popularity signals of a game that size a release (lib/releases/heat.ts). */
const HEAT_FIELDS = { popularity: true, steamReviewTotal: true, steamPlayers: { select: { current: true } } } as const;
type HeatGame = { popularity: number; steamReviewTotal: number | null; steamPlayers: { current: number } | null };

const inMonth = (month: Month) => {
  const prefix = `${monthParam(month)}-`;
  return (day: string) => day.startsWith(prefix);
};

/** Published articles and releases of the month (the same for every visitor: cacheable). */
export async function getPublicMonth(month: Month): Promise<CalendarEvent[]> {
  const within = inMonth(month);
  const instants = instantBounds(month);
  const days = utcBounds(month);
  const [articles, releases, catalog] = await Promise.all([
    prisma.article.findMany({
      where: { status: "published", publishedAt: { gte: instants.start, lt: instants.end } },
      select: { slug: true, title: true, category: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
      take: MONTH_ARTICLE_LIMIT,
    }),
    prisma.gameRelease.findMany({
      where: { date: { gte: days.start, lt: days.end } },
      select: {
        gameId: true,
        platform: true,
        date: true,
        score: true,
        source: true,
        game: { select: { slug: true, name: true, coverUrl: true, ...HEAT_FIELDS } },
      },
      orderBy: { score: "desc" },
      take: MONTH_RELEASE_LIMIT,
    }),
    prisma.game.findMany({
      where: { stub: false, releaseDate: { gte: days.start, lt: days.end } },
      select: { id: true, slug: true, name: true, platforms: true, releaseDate: true, coverUrl: true, ...HEAT_FIELDS },
      orderBy: [{ popularity: "desc" }, { name: "asc" }],
      take: MONTH_RELEASE_LIMIT,
    }),
  ]);

  const events: CalendarEvent[] = articles
    .map((a) => ({ a, day: dayKey(a.publishedAt) }))
    .filter(({ day }) => within(day))
    .map(({ a, day }) => ({
      kind: "article" as const,
      day,
      title: a.title,
      detail: CATEGORY_LABEL[a.category] ?? null,
      href: `/noticias/${a.slug}`,
      weight: a.publishedAt.getTime() / 1e12,
    }));

  // One entry per game and day: GameRelease rows (per platform) merged, then catalog dates.
  type Entry = {
    slug: string;
    name: string;
    day: string;
    coverUrl: string | null;
    platforms: Set<ReleasePlatform>;
    steamList: number[];
    igdb: number[];
    game: HeatGame;
  };
  const releaseByKey = new Map<string, Entry>();
  for (const r of releases) {
    if (!r.date) continue;
    const day = utcDayKey(r.date);
    const key = `${r.gameId}:${day}`;
    const entry: Entry = releaseByKey.get(key) ?? {
      slug: r.game.slug,
      name: r.game.name,
      day,
      coverUrl: r.game.coverUrl,
      platforms: new Set(),
      steamList: [],
      igdb: [],
      game: r.game,
    };
    entry.platforms.add(r.platform as ReleasePlatform);
    (r.source === "igdb" ? entry.igdb : entry.steamList).push(r.score);
    releaseByKey.set(key, entry);
  }
  const releasedGames = new Set([...releases].map((r) => r.gameId));
  for (const g of catalog) {
    if (!g.releaseDate || releasedGames.has(g.id)) continue;
    const day = utcDayKey(g.releaseDate);
    releaseByKey.set(`${g.id}:${day}`, {
      slug: g.slug,
      name: g.name,
      day,
      coverUrl: g.coverUrl,
      platforms: new Set(g.platforms.filter((p): p is ReleasePlatform => (RELEASE_PLATFORMS as readonly string[]).includes(p))),
      steamList: [],
      igdb: [],
      game: g,
    });
  }
  for (const r of releaseByKey.values()) {
    const heat = releaseHeat({
      steamList: r.steamList,
      igdb: r.igdb,
      reviews: r.game.steamReviewTotal,
      owners: r.game.popularity,
      players: r.game.steamPlayers?.current,
    });
    events.push({
      kind: "release",
      day: r.day,
      title: r.name,
      detail: platformsText([...r.platforms]),
      href: `/jogos/${r.slug}`,
      weight: heat,
      imageUrl: r.coverUrl,
      big: heat >= BIG_RELEASE_HEAT,
    });
  }
  return events;
}

/** Achievements, hours milestones and missions of one player in the month. */
export async function getPersonalMonth(userId: string, month: Month): Promise<CalendarEvent[]> {
  const within = inMonth(month);
  const { start, end } = instantBounds(month);
  const [unlocks, milestones, missions] = await Promise.all([
    // One row per Brasília day and game: how many, and the rarest one.
    prisma.$queryRaw<{ day: string; slug: string; name: string; count: number; rarest: string | null; pct: number | null }[]>`
      SELECT to_char((ua."unlockedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
             g.slug, g.name, count(*)::int AS count,
             (array_agg(a.name ORDER BY a."globalPct" ASC NULLS LAST))[1] AS rarest,
             min(a."globalPct") AS pct
      FROM "UserAchievement" ua
      JOIN "Achievement" a ON a.id = ua."achievementId"
      JOIN "Game" g ON g.id = a."gameId"
      WHERE ua."userId" = ${userId} AND ua."unlockedAt" >= ${start} AND ua."unlockedAt" < ${end}
        AND (ua."fraudReview" IS NULL OR ua."fraudReview" <> 'confirmed')
      GROUP BY 1, g.id, g.slug, g.name`,
    prisma.xpLedgerEntry.findMany({
      where: { userId, source: "playtime", voidedAt: null, createdAt: { gte: start, lt: end } },
      select: { sourceKey: true, createdAt: true, xp: true },
    }),
    prisma.mission.findMany({
      where: { userId, completedAt: { gte: start, lt: end } },
      select: { title: true, kind: true, completedAt: true, rewardXp: true },
    }),
  ]);

  const events: CalendarEvent[] = [];
  for (const u of unlocks) {
    if (!within(u.day)) continue;
    events.push({
      kind: "unlock",
      day: u.day,
      title: u.count === 1 ? `1 conquista em ${u.name}` : `${u.count} conquistas em ${u.name}`,
      detail: u.rarest ? `${u.count === 1 ? "" : "Mais rara: "}${u.rarest}${u.pct !== null ? ` (${formatPct(u.pct)})` : ""}` : null,
      href: `/jogos/${u.slug}`,
      weight: u.count,
    });
  }

  // sourceKey = "<platform>:<gameId>:<hours>" (lib/sync/playtime.ts).
  const parsed = milestones.flatMap((m) => {
    const [platform, gameId, hours] = m.sourceKey.split(":");
    const h = Number(hours);
    return gameId && Number.isFinite(h) ? [{ platform, gameId, hours: h, day: dayKey(m.createdAt), xp: m.xp }] : [];
  });
  const games = parsed.length
    ? await prisma.game.findMany({ where: { id: { in: [...new Set(parsed.map((p) => p.gameId))] } }, select: { id: true, slug: true, name: true } })
    : [];
  const gameById = new Map(games.map((g) => [g.id, g]));
  for (const p of parsed) {
    const game = gameById.get(p.gameId);
    if (!game || !within(p.day)) continue;
    events.push({
      kind: "playtime",
      day: p.day,
      title: `${p.hours.toLocaleString("pt-BR")} h em ${game.name}`,
      detail: `${PLATFORM_NAME[p.platform] ?? p.platform} · +${p.xp.toLocaleString("pt-BR")} XP`,
      href: `/jogos/${game.slug}`,
      weight: p.hours,
    });
  }

  for (const m of missions) {
    if (!m.completedAt) continue;
    const day = dayKey(m.completedAt);
    if (!within(day)) continue;
    events.push({
      kind: "mission",
      day,
      title: m.title,
      detail: `Missão ${m.kind === "weekly" ? "semanal" : "diária"} · +${m.rewardXp.toLocaleString("pt-BR")} XP`,
      href: null,
      weight: m.rewardXp,
    });
  }
  return events;
}

const PLATFORM_NAME: Record<string, string> = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" };

function formatPct(pct: number): string {
  return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: pct < 10 ? 1 : 0 })}%`;
}
