import type { Prisma } from "@/generated/prisma/client";

export type IgdbCursor = { igdbId: number; id: string };

/**
 * Where of the page of catalog games with an IGDB id that follows `cursor`, in (igdbId, id) order.
 * Several catalog games may share one IGDB id, so the id alone (igdbId > last) would skip the ones
 * of that id that did not fit in the previous page. Stubs (store-only rows) are left out: nothing
 * in the catalog filters reads their consoles. The `gte` is redundant with the OR but gives the
 * igdbId index a start point.
 */
export function igdbPageWhere(cursor: IgdbCursor | null): Prisma.GameWhereInput {
  if (!cursor) return { stub: false, igdbId: { not: null } };
  return {
    AND: [
      { stub: false },
      { igdbId: { gte: cursor.igdbId } },
      { OR: [{ igdbId: { gt: cursor.igdbId } }, { igdbId: cursor.igdbId, id: { gt: cursor.id } }] },
    ],
  };
}

export const IGDB_PAGE_ORDER = [{ igdbId: "asc" as const }, { id: "asc" as const }];
