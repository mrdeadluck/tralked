/**
 * Numbered pagination shared by /jogos, /familia and the profile lists (Plano 4, F11). State lives
 * in the URL (`?pagina=&por=`), so every page is a plain link and works without JavaScript.
 */

export const PER_PAGE_OPTIONS = [10, 20, 40, 80] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];
export const DEFAULT_PER_PAGE: PerPage = 40;

/** URL parameter names (pt-BR, like the rest of the site's query strings). */
export const PAGE_PARAM = "pagina";
export const PER_PAGE_PARAM = "por";

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** First value of a query parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Requested page (1-based, not yet clamped to the last page) and page size from the URL. */
export function parsePagination(params: SearchParamsRecord): { page: number; perPage: PerPage } {
  const rawPage = Number(firstParam(params[PAGE_PARAM]));
  const rawPer = Number(firstParam(params[PER_PAGE_PARAM]));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer) ? (rawPer as PerPage) : DEFAULT_PER_PAGE;
  return { page, perPage };
}

/** The `por` value a list keeps in its links and forms: absent for the default size. */
export function perPageParam(perPage: number): string | undefined {
  return perPage === DEFAULT_PER_PAGE ? undefined : String(perPage);
}

export type PageWindow = {
  /** Clamped to 1..totalPages. */
  page: number;
  perPage: number;
  total: number;
  /** At least 1 (an empty list still has page 1). */
  totalPages: number;
  /** Rows to skip. */
  offset: number;
};

/** Clamps the requested page to the list size (a page past the end shows the last one). */
export function pageWindow(requestedPage: number, perPage: number, total: number): PageWindow {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
  return { page, perPage, total, totalPages, offset: (page - 1) * perPage };
}

/** One page of an in-memory list. */
export function paginate<T>(items: T[], requestedPage: number, perPage: number): PageWindow & { items: T[] } {
  const window = pageWindow(requestedPage, perPage, items.length);
  return { ...window, items: items.slice(window.offset, window.offset + perPage) };
}

export type PageItem = number | "gap";

/**
 * Page numbers to show: always the first and last, the current one with `siblings` on each side,
 * and "gap" (an ellipsis) for every hidden run. A gap never hides a single page (it shows the
 * number instead), so the list keeps a constant width while moving through the pages.
 */
export function pageItems(current: number, totalPages: number, siblings = 1): PageItem[] {
  if (totalPages <= 1) return [1];
  // first + last + current + 2·siblings + 2 gaps
  const slots = 2 * siblings + 5;
  if (totalPages <= slots) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const page = Math.min(Math.max(1, current), totalPages);
  let start = Math.max(2, page - siblings);
  let end = Math.min(totalPages - 1, page + siblings);
  // Near an edge, extend the window so the count of items stays the same.
  if (page - siblings <= 3) {
    start = 2;
    end = Math.max(end, 2 + 2 * siblings + 1);
  }
  if (page + siblings >= totalPages - 2) {
    end = totalPages - 1;
    start = Math.min(start, totalPages - 1 - 2 * siblings - 1);
  }

  const items: PageItem[] = [1];
  if (start > 2) items.push("gap");
  for (let n = start; n <= end; n++) items.push(n);
  if (end < totalPages - 1) items.push("gap");
  items.push(totalPages);
  return items;
}

/**
 * `basePath?query` keeping `params` (string values only, empty ones dropped) with `changes`
 * applied (`undefined` removes a key). Page 1 and the default page size are left out of the URL.
 */
export function hrefWith(
  basePath: string,
  params: Record<string, string | undefined>,
  changes: Record<string, string | number | undefined> = {},
): string {
  const merged: Record<string, string | undefined> = { ...params };
  for (const [key, value] of Object.entries(changes)) merged[key] = value === undefined ? undefined : String(value);
  if (merged[PAGE_PARAM] === "1") delete merged[PAGE_PARAM];
  if (merged[PER_PAGE_PARAM] === String(DEFAULT_PER_PAGE)) delete merged[PER_PAGE_PARAM];
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** The URL state a list page keeps across links: its known params, first values only. */
export function pickParams(params: SearchParamsRecord, keys: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = firstParam(params[key])?.trim();
    if (value) out[key] = value;
  }
  return out;
}
