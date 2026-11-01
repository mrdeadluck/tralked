import { prisma } from "@/lib/db";

export { cleanQuery, foldName, nameMatches, SEARCH_MAX_LENGTH } from "./fold";

/**
 * The query folded by the database's own `tralked_search_name` (for `searchName contains`), so it
 * matches the trigger-written `Game.searchName` exactly (see fold.ts).
 */
export async function foldQueryInDb(query: string): Promise<string> {
  const [row] = await prisma.$queryRaw<{ folded: string }[]>`SELECT tralked_search_name(${query}) AS folded`;
  return row?.folded ?? "";
}
