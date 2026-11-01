import type { Prisma } from "@/generated/prisma/client";
import { dayKey, MONTH_NAMES } from "@/lib/calendar/month";
import { prisma } from "@/lib/db";
import { igdbCatalogAvailable } from "@/lib/integrations/igdb";
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

type Row = Prisma.GameReleaseGetPayload<{ include: { game: { select: { slug: true; name: true; coverUrl: true; stub: true } } } }>;

/**
 * Groups release rows by game (a game out on PC and PS5 in the window is one entry with both
 * platforms; its day is the earliest of them for "Próximos", the latest for "Últimos"). Only the
 * rows inside the window count: a PS5 release still ahead is not listed under "Últimos".
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
      platforms,
      day,
      dateText: day ? releaseDateText(day, todayKey) : (label ?? "a definir"),
      relative: day ? relativeDay(day, todayKey) : null,
      score: Math.max(...group.map((r) => r.score)),
      stub: game.stub,
    });
  }
  return views.sort((a, b) => {
    if (a.day !== b.day) {
      if (a.day === null) return 1;
      if (b.day === null) return -1;
      return tab === "proximos" ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day);
    }
    return b.score - a.score || a.name.localeCompare(b.name, "pt-BR");
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
 * Releases of a tab, most recent / soonest first; with `platform`, the games out on that family
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
    include: { game: { select: { slug: true, name: true, coverUrl: true, stub: true } } },
  });
  return groupReleases(rows, tab, todayUtc(now).key);
}

/** The `n` most popular releases of a list, shown in date order (the card's picks). */
export function topReleases(list: ReleaseView[], n: number): ReleaseView[] {
  const picked = new Set([...list].sort((a, b) => b.score - a.score).slice(0, n).map((r) => r.gameId));
  return list.filter((r) => picked.has(r.gameId));
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
