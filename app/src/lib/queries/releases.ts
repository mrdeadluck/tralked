import type { Prisma } from "@/generated/prisma/client";
import { dayKey, MONTH_NAMES } from "@/lib/calendar/month";
import { isWideArt } from "@/lib/case-art";
import { prisma } from "@/lib/db";
import { igdbCatalogAvailable } from "@/lib/integrations/igdb";
import { releaseHeat } from "@/lib/releases/heat";
import { RELEASE_PLATFORMS, isReleasePlatform, type ReleasePlatform } from "@/lib/releases/platforms";
import {
  RELEASE_FILTERS,
  type ReleaseFilter,
  type ReleasesCardData,
  type ReleaseTab,
  type ReleaseView,
} from "@/lib/releases/view";

export { RELEASE_FILTERS, RELEASE_TABS } from "@/lib/releases/view";
export type { ReleaseFilter, ReleasesCardData, ReleaseTab, ReleaseView } from "@/lib/releases/view";

/** Cache tag of every page that shows releases (home card, /lancamentos, calendar). */
export const RELEASES_TAG = "releases";

const DAY_MS = 86_400_000;
export const PAST_DAYS = 30;
export const AHEAD_DAYS = 90;
/** Upcoming releases leave "Próximos" when no source listed them for this long. */
const FRESH_DAYS = 14;
/** Most games one list (tab × filter) holds, the most popular first. */
export const LIST_LIMIT = 400;

const SHORT_MONTHS = MONTH_NAMES.map((m) => (m.length > 4 ? `${m.slice(0, 3)}.` : m));

/** "14 de nov." (and the year when it is not the current one). */
export function releaseDateText(day: string, todayKey: string): string {
  const [year, month, d] = day.split("-").map(Number);
  const sameYear = todayKey.slice(0, 4) === day.slice(0, 4);
  return `${d} de ${SHORT_MONTHS[month - 1]}${sameYear ? "" : ` de ${year}`}`;
}

export function relativeDay(day: string, todayKey: string): string {
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  return diff > 0 ? `em ${diff} dias` : `há ${-diff} dias`;
}

/** Game fields a release list reads: what it shows and the popularity signals behind `heat`. */
const GAME_SELECT = {
  slug: true,
  name: true,
  coverUrl: true,
  // The store's 616×353 capsule (key art with the logo, nearly 16:9) for wide thumbnails.
  media: { where: { kind: "capsule", url: { not: null } }, orderBy: { order: "asc" }, take: 1, select: { url: true } },
  stub: true,
  popularity: true,
  steamReviewTotal: true,
  steamPlayers: { select: { current: true } },
} as const satisfies Prisma.GameSelect;

type Row = Prisma.GameReleaseGetPayload<{ include: { game: { select: typeof GAME_SELECT } } }>;

/**
 * Groups release rows by game (a game out on PC and PS5 in the window is one entry with both
 * platforms; its day is the earliest of them for "Próximos", the latest for "Últimos"). Only the
 * rows inside the window count: a PS5 release still ahead is not listed under "Últimos".
 * Biggest releases first (`heat`), so the big launches lead and the long tail sinks; ties go to
 * the most recent (Últimos) or the soonest (Próximos) day.
 */
export function groupReleases(rows: Row[], tab: ReleaseTab, todayKey: string): ReleaseView[] {
  const byGame = new Map<string, { rows: Row[] }>();
  for (const row of rows) {
    const entry = byGame.get(row.gameId) ?? { rows: [] };
    entry.rows.push(row);
    byGame.set(row.gameId, entry);
  }
  const views: ReleaseView[] = [];
  for (const { rows: group } of byGame.values()) {
    const dated = group.filter((r) => r.date).map((r) => r.date!.toISOString().slice(0, 10)).sort();
    const day = dated.length === 0 ? null : tab === "proximos" ? dated[0] : dated[dated.length - 1];
    const label = group.find((r) => !r.date && r.dateLabel)?.dateLabel ?? null;
    const { game } = group[0];
    const platforms = RELEASE_PLATFORMS.filter((p) => group.some((r) => r.platform === p));
    views.push({
      gameId: group[0].gameId,
      slug: game.slug,
      name: game.name,
      coverUrl: game.coverUrl,
      capsuleUrl: group.find((r) => r.imageUrl)?.imageUrl ?? null,
      wideUrl: game.media[0]?.url ?? null,
      platforms,
      day,
      dateText: day ? releaseDateText(day, todayKey) : (label ?? "a definir"),
      relative: day ? relativeDay(day, todayKey) : null,
      score: Math.max(...group.map((r) => r.score)),
      heat: releaseHeat({
        steamList: group.filter((r) => r.source === "steam").map((r) => r.score),
        igdb: group.filter((r) => r.source === "igdb").map((r) => r.score),
        reviews: game.steamReviewTotal,
        owners: game.popularity,
        players: game.steamPlayers?.current,
      }),
      stub: game.stub,
    });
  }
  return views.sort((a, b) => {
    if (a.heat !== b.heat) return b.heat - a.heat;
    if (a.day !== b.day) {
      if (a.day === null) return 1;
      if (b.day === null) return -1;
      return tab === "proximos" ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day);
    }
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

/** Today's calendar day in Brasília, as the UTC midnight release dates are stored at. */
export function todayUtc(now: Date): { key: string; date: Date } {
  const key = dayKey(now);
  return { key, date: new Date(`${key}T00:00:00Z`) };
}

/**
 * Which release rows a tab shows. A source must still vouch for each one:
 * - Últimos: out in the last 30 days, and listed by a source on or after that day (a game that
 *   was only ever seen as upcoming and then dropped off the lists may have been delayed);
 * - Próximos: in the next 90 days, or undated, and listed in the last two weeks (a delayed game
 *   is listed again with its new date; one no source lists anymore leaves).
 */
export function releaseWindow(tab: ReleaseTab, now: Date): Prisma.GameReleaseWhereInput {
  const today = todayUtc(now).date;
  if (tab === "ultimos") {
    return {
      date: { gte: new Date(today.getTime() - PAST_DAYS * DAY_MS), lte: today },
      seenAt: { gte: prisma.gameRelease.fields.date },
    };
  }
  return {
    seenAt: { gte: new Date(now.getTime() - FRESH_DAYS * DAY_MS) },
    OR: [{ date: { gt: today, lte: new Date(today.getTime() + AHEAD_DAYS * DAY_MS) } }, { date: null }],
  };
}

/**
 * Releases of a tab, biggest first (see groupReleases); with `platform`, the games out on that family
 * (still listing all their platforms in the window). The family is filtered in SQL
 * (GameRelease_platform_date_idx) before the most popular games are taken, so a busy family never
 * pushes another out; then every row of those games in the window is loaded.
 */
export async function listReleases(tab: ReleaseTab, now: Date, platform?: ReleasePlatform): Promise<ReleaseView[]> {
  const window = releaseWindow(tab, now);
  const picked = await prisma.gameRelease.findMany({
    where: platform ? { AND: [window, { platform }] } : window,
    select: { gameId: true },
    orderBy: [{ score: "desc" }, { gameId: "asc" }],
    take: LIST_LIMIT,
  });
  if (picked.length === 0) return [];
  const rows = await prisma.gameRelease.findMany({
    where: { AND: [window, { gameId: { in: [...new Set(picked.map((p) => p.gameId))] } }] },
    include: { game: { select: GAME_SELECT } },
  });
  return groupReleases(rows, tab, todayUtc(now).key);
}

/** The `n` biggest releases of a list, biggest first (the home card's picks). */
export function topReleases(list: ReleaseView[], n: number): ReleaseView[] {
  return [...list].sort((a, b) => b.heat - a.heat).slice(0, n);
}

/**
 * "Destaques da semana" of /lancamentos: the biggest releases of the seven days nearest today
 * (out in the last week for Últimos, coming in the next one for Próximos). Fewer than `min` that
 * week: the biggest of the whole list instead, with `week` false so the title can say so.
 */
export function weekHighlights(
  list: ReleaseView[],
  tab: ReleaseTab,
  todayKey: string,
  n = 4,
  min = 3,
): { picks: ReleaseView[]; week: boolean } {
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  const inWeek = (r: ReleaseView) => {
    if (!r.day) return false;
    const diff = (Date.parse(`${r.day}T00:00:00Z`) - today) / DAY_MS;
    return tab === "ultimos" ? diff <= 0 && diff > -7 : diff >= 0 && diff < 7;
  };
  const week = list.filter(inWeek);
  return week.length >= min ? { picks: coverFirst(week, n), week: true } : { picks: coverFirst(list, n), week: false };
}

/** A stored portrait cover (not wide store art kept as the cover). */
const hasCover = (r: ReleaseView) => Boolean(r.coverUrl) && !isWideArt(r.coverUrl);

/**
 * The `n` picks of the highlights: among the biggest releases (twice as many as needed), those
 * with a real cover first, so the large cases show cover art; then the biggest of the rest.
 * Biggest first inside each group.
 */
function coverFirst(list: ReleaseView[], n: number): ReleaseView[] {
  const pool = topReleases(list, n * 2);
  const covered = pool.filter(hasCover);
  return [...covered, ...pool.filter((r) => !hasCover(r))].slice(0, n).sort((a, b) => b.heat - a.heat);
}

export async function getReleasesCard(now: Date, perList = 6): Promise<ReleasesCardData> {
  // One query per tab and filter, so each family gets its own most popular games.
  const tab = async (id: ReleaseTab) =>
    Object.fromEntries(
      await Promise.all(
        RELEASE_FILTERS.map(async (f) => [f, topReleases(await listReleases(id, now, f === "TODAS" ? undefined : f), perList)] as const),
      ),
    ) as Record<ReleaseFilter, ReleaseView[]>;
  const [ultimos, proximos] = await Promise.all([tab("ultimos"), tab("proximos")]);
  return { tabs: { ultimos, proximos }, consolesOff: !igdbCatalogAvailable() };
}

/** /lancamentos: every release of a tab and filter; `consolesOff` when IGDB is off and it matters. */
export async function getReleaseList(
  tab: ReleaseTab,
  filter: ReleaseFilter,
  now: Date,
): Promise<{ releases: ReleaseView[]; consolesOff: boolean }> {
  const releases = await listReleases(tab, now, filter === "TODAS" ? undefined : filter);
  return { releases, consolesOff: filter !== "PC" && !igdbCatalogAvailable() };
}

export function parseReleaseTab(value: string | undefined): ReleaseTab | null {
  return value === "ultimos" || value === "proximos" ? value : null;
}

export function parseReleaseFilter(value: string | undefined): ReleaseFilter {
  const upper = value?.toUpperCase();
  return upper === "TODAS" ? "TODAS" : isReleasePlatform(upper) ? upper : "PC";
}
