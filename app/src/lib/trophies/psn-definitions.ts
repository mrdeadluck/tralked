import type { TrophyTier } from "@/lib/engine/trophies";

// Checks of a PSN trophy list's definitions against what Sony says about the list elsewhere.
// Sony once answered `npCommunicationIds/NPWR09510_00/trophyGroups/all/trophies` (Guns, Gore and
// Cannoli) with The Crew 2's list (NPWR14350_00) in Arabic; the sync wrote it as the list's own.
// The title list of the player (`definedTrophies`) and the icon URLs (which name their list) tell
// such an answer apart.

export type TierCounts = Record<TrophyTier, number>;

const TIERS: TrophyTier[] = ["platinum", "gold", "silver", "bronze"];

/** Rows (or trophies) per tier; rows without a tier are not counted. */
export function tierCounts(rows: { trophyTier: string | null }[]): TierCounts {
  const out: TierCounts = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  for (const r of rows) if (r.trophyTier && r.trophyTier in out) out[r.trophyTier as TrophyTier]++;
  return out;
}

export const sameTierCounts = (a: TierCounts, b: TierCounts) => TIERS.every((t) => a[t] === b[t]);

const total = (c: TierCounts) => TIERS.reduce((sum, t) => sum + c[t], 0);

/** Counts Sony gave (a title list without `definedTrophies` reads as all zero: unknown). */
export const knownCounts = (c: TierCounts | null | undefined): c is TierCounts => !!c && total(c) > 0;

/** "35 trophies (1 platinum, 3 gold, 15 silver, 16 bronze)". */
export function describeCounts(c: TierCounts): string {
  const parts = TIERS.filter((t) => c[t] > 0).map((t) => `${c[t]} ${t}`);
  return `${total(c)} trophies${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

const LIST_ID = /NPWR\d{5}_\d{2}/;

/** The trophy list an icon URL names (`…/trophy/np/NPWR09510_00_…`, `…/psnobj/NPWR19950_00/…`), or null. */
export function iconListId(url: string | null): string | null {
  return url ? (LIST_ID.exec(url)?.[0] ?? null) : null;
}

/** Lists other than `externalId` that the icons name, sorted. */
export function foreignIconLists(externalId: string, iconUrls: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const url of iconUrls) {
    const id = iconListId(url);
    if (id && id !== externalId) out.add(id);
  }
  return [...out].sort();
}

/**
 * Why an answer of Sony with a list's trophy definitions cannot be that list's (null when it can):
 * its count or tiers differ from the list's `definedTrophies` (when known), or an icon names
 * another list (icons without a list id are not judged).
 */
export function definitionsProblem(
  externalId: string,
  defined: TierCounts | null | undefined,
  trophies: { tier: TrophyTier; iconUrl: string | null }[],
): string | null {
  const problems: string[] = [];
  if (knownCounts(defined)) {
    const got = tierCounts(trophies.map((t) => ({ trophyTier: t.tier })));
    if (!sameTierCounts(got, defined)) {
      problems.push(`the answer has ${describeCounts(got)}, the title list defines ${describeCounts(defined).replace(" trophies", "")}`);
    }
  }
  const foreign = foreignIconLists(externalId, trophies.map((t) => t.iconUrl));
  if (foreign.length > 0) problems.push(`icons of ${foreign.join(", ")}`);
  return problems.length ? problems.join("; ") : null;
}
