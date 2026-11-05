import type { Prisma } from "@/generated/prisma/client";

export type IgdbCursor = { igdbId: number; id: string };

/**
 * Where of the page of catalog games with an IGDB id that follows `cursor`, in (igdbId, id) order.
 * Several catalog games may share one IGDB id, so the id alone (igdbId > last) would skip the ones
 * of that id that did not fit in the previous page.
 */
export function igdbPageWhere(cursor: IgdbCursor | null): Prisma.GameWhereInput {
  if (!cursor) return { igdbId: { not: null } };
  return { OR: [{ igdbId: { gt: cursor.igdbId } }, { igdbId: cursor.igdbId, id: { gt: cursor.id } }] };
}

export const IGDB_PAGE_ORDER = [{ igdbId: "asc" as const }, { id: "asc" as const }];
