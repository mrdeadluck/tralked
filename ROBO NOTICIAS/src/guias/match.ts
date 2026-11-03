import type { GuideCompat } from "./contract.js";

/** Lowercase, no accents, no punctuation, `&` -> "and", typographic quotes dropped. */
export function normalizeName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’‚‛′`´']/g, "")
    .replace(/[“”„″"]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return plain || text.trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length]!;
}

/** 1 - edit distance / longest length, over the normalized texts. */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (x === y) return 1;
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 1 : 1 - levenshtein(x, y) / longest;
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeName(text).split(" ").filter((w) => w.length > 2));
}

/** Both descriptions must exist and share at least half of their words. */
function descriptionsCompatible(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const x = wordSet(a);
  const y = wordSet(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.5;
}

export type SteamEntry = { apiName: string; name: string; nameEn?: string; description?: string | null };
export type OtherEntry = { nameEn: string; description?: string | null };

/**
 * Index of the entry of `other` that is this Steam achievement, or -1. Exact normalized name first;
 * otherwise the most similar name (>= 0.9) whose description is also compatible.
 */
export function findMatch(steam: SteamEntry, other: OtherEntry[]): number {
  const names = [steam.nameEn ?? steam.name, steam.name].map(normalizeName);
  const exact = other.findIndex((o) => names.includes(normalizeName(o.nameEn)));
  if (exact >= 0) return exact;
  let best = -1;
  let bestScore = 0.9;
  other.forEach((o, index) => {
    const score = Math.max(similarity(steam.nameEn ?? steam.name, o.nameEn), similarity(steam.name, o.nameEn));
    if (score >= bestScore && descriptionsCompatible(steam.description, o.description)) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** For each Steam achievement (the master list): is it on the other platform's list? */
export function matchAchievements(steam: SteamEntry[], other: OtherEntry[]): { apiName: string; matched: boolean }[] {
  return steam.map((s) => ({ apiName: s.apiName, matched: findMatch(s, other) >= 0 }));
}

/** apiName of the Steam achievement that one foreign entry names, if any. */
export function steamApiNameFor(steam: SteamEntry[], entry: OtherEntry): string | undefined {
  return steam.find((s) => findMatch(s, [entry]) >= 0)?.apiName;
}

/**
 * The seal of the guide. A list covers the game when all of its trophies matched a Steam achievement and it has the
 * same size as the Steam list (+1 tolerated: the PlayStation platinum has no Steam counterpart). Anything else
 * leaves Steam-only achievements, so the guide is `steam_only`.
 */
export function computeCompat(
  steamCount: number,
  lists: { platform: "psn" | "xbox"; matchedAll: boolean; size: number }[],
): GuideCompat {
  const covers = (platform: "psn" | "xbox") =>
    lists.some((l) => l.platform === platform && l.matchedAll && l.size >= steamCount && l.size <= steamCount + 1);
  const psn = covers("psn");
  const xbox = covers("xbox");
  if (psn && xbox) return "psn_xbox";
  if (psn) return "psn";
  if (xbox) return "xbox";
  return "steam_only";
}
