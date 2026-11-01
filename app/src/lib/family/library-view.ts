import { compareNames, foldName } from "@/lib/search/fold";
import type { FamilyLibraryEntry } from "./service";

/**
 * Filters and orders of the family library (Plano 4, F11), on the merged list in memory (at most
 * 6 libraries). Pure, so the page and the tests share it.
 */

/**
 * Who owns it: everyone in the library ("todos-tem"), more than one member ("varios": play
 * together), exactly one ("so-um"), or games nobody played yet ("ninguem").
 */
export const OWNERSHIP_FILTERS = ["todos", "todos-tem", "varios", "so-um", "ninguem"] as const;
export type OwnershipFilter = (typeof OWNERSHIP_FILTERS)[number];

export const FAMILY_SORTS = ["nome", "horas", "donos", "progresso"] as const;
export type FamilySort = (typeof FAMILY_SORTS)[number];

export type FamilyLibraryQuery = {
  ownership?: OwnershipFilter;
  /** Only games this member (handle) owns. */
  member?: string;
  /** Raw name query. */
  q?: string;
  /** Members whose libraries are in the list (for "todos-tem"). */
  sharingMembers: number;
};

export function filterFamilyLibrary(entries: FamilyLibraryEntry[], query: FamilyLibraryQuery): FamilyLibraryEntry[] {
  const folded = query.q ? foldName(query.q) : "";
  return entries.filter((e) => {
    if (query.member && !e.owners.some((o) => o.handle === query.member)) return false;
    if (folded && !foldName(e.game.name).includes(folded)) return false;
    switch (query.ownership ?? "todos") {
      case "todos-tem":
        return query.sharingMembers > 1 && e.owners.length === query.sharingMembers;
      case "varios":
        return e.owners.length > 1;
      case "so-um":
        return e.owners.length === 1;
      case "ninguem":
        return e.playtimeMin === 0 && e.bestProgress.unlocked <= 0;
      case "todos":
        return true;
    }
  });
}

const byName = (a: FamilyLibraryEntry, b: FamilyLibraryEntry) => compareNames(a.game.name, b.game.name);

export function sortFamilyLibrary(entries: FamilyLibraryEntry[], sort: FamilySort): FamilyLibraryEntry[] {
  const list = [...entries];
  switch (sort) {
    case "nome":
      return list.sort(byName);
    case "horas":
      return list.sort((a, b) => b.playtimeMin - a.playtimeMin || byName(a, b));
    case "donos":
      return list.sort((a, b) => b.owners.length - a.owners.length || b.playtimeMin - a.playtimeMin || byName(a, b));
    case "progresso":
      return list.sort((a, b) => b.bestProgress.pct - a.bestProgress.pct || byName(a, b));
  }
}
