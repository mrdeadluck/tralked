import type { ExtractedFacts } from "./facts.js";
import { normalizeName } from "./match.js";

const SHINGLE = 5;
const SAME_SOURCE = 0.6;

function shingles(text: string): Set<string> {
  const words = normalizeName(text).split(" ").filter(Boolean);
  if (words.length <= SHINGLE) return new Set([words.join(" ")]);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i++) set.add(words.slice(i, i + SHINGLE).join(" "));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared || 1);
}

/**
 * Groups of urls that are really one source: pages whose 5-word shingles overlap by Jaccard >= 0.6 (a copy of
 * PowerPyx is not a second opinion). Groups keep the input order; every url lands in exactly one group.
 */
export function independentGroups(pages: { url: string; text: string }[]): string[][] {
  const sets = pages.map((p) => shingles(p.text));
  const parent = pages.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      if (jaccard(sets[i]!, sets[j]!) >= SAME_SOURCE) parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, string[]>();
  pages.forEach((p, i) => {
    const root = find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), p.url]);
  });
  return [...byRoot.values()];
}

/**
 * Names the independent groups after their first source (duplicates get " (2)") and answers which group a fact
 * belongs to. A url missing from `groups` is a group of its own.
 */
export function buildSourceGroups(facts: ExtractedFacts[], groups: string[][]) {
  const groupOfUrl = new Map<string, number>();
  groups.forEach((urls, index) => urls.forEach((u) => groupOfUrl.set(u, index)));
  const idOf = (fact: ExtractedFacts) => {
    const index = groupOfUrl.get(fact.source.url);
    return index === undefined ? `url:${fact.source.url}` : `group:${index}`;
  };
  const nameOfId = new Map<string, string>();
  const taken = new Map<string, number>();
  for (const fact of facts) {
    const id = idOf(fact);
    if (nameOfId.has(id)) continue;
    const count = (taken.get(fact.source.name) ?? 0) + 1;
    taken.set(fact.source.name, count);
    nameOfId.set(id, count === 1 ? fact.source.name : `${fact.source.name} (${count})`);
  }
  return { nameOf: (fact: ExtractedFacts) => nameOfId.get(idOf(fact))! };
}

/** "4 fragments = 1 amber", as some source states it. */
export type FragmentRule = { perUnit: number; unit: string; sources: string[] };

const FRAGMENT_RULE =
  /(\d+)\s*(?:x\s*)?(?:fragments?|fragmentos?|shards?|pieces?|pedacos?)\s*(?:=|->|→|equals?(?:\s+to)?|makes?|forms?|to\s+make|to\s+form|per|for|formam|viram|valem|vale|dao)\s*(?:1|one|an?|um|uma)?\s*(?:whole\s+|complete\s+|full\s+|inteir[oa]\s+)?([a-z]+)/g;

/** Looks for the fragment rule in the text the sources wrote (item names, notes, how-tos, roadmap). */
export function findFragmentRules(text: string): { perUnit: number; unit: string }[] {
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return [...plain.matchAll(FRAGMENT_RULE)]
    .map((m) => ({ perUnit: Number(m[1]), unit: m[2]! }))
    .filter((r) => r.perUnit >= 2);
}

export function factTexts(fact: ExtractedFacts): string[] {
  return [
    ...fact.chapters.flatMap((c) => c.items.flatMap((i) => [i.name, i.nameEn ?? "", i.location])),
    ...fact.achievements.map((a) => a.howTo),
    ...(fact.roadmap ?? []).map((r) => r.summary),
    fact.playthroughs?.note ?? "",
    fact.difficulty?.note ?? "",
  ];
}

/** Rules per unit; a unit two sources state differently is returned in `conflicts` (first statement wins). */
export function detectFragmentRules(facts: ExtractedFacts[], nameOf: (f: ExtractedFacts) => string) {
  const rules: FragmentRule[] = [];
  const conflicts: string[] = [];
  for (const fact of facts) {
    const sourceName = nameOf(fact);
    for (const text of factTexts(fact)) {
      for (const found of findFragmentRules(text)) {
        const existing = rules.find((r) => normalizeName(r.unit) === normalizeName(found.unit));
        if (!existing) rules.push({ ...found, sources: [sourceName] });
        else if (existing.perUnit === found.perUnit) {
          if (!existing.sources.includes(sourceName)) existing.sources.push(sourceName);
        } else {
          const message = `${sourceName} diz que ${found.perUnit} fragmentos formam 1 ${found.unit}, mas ${existing.sources.join(", ")} diz ${existing.perUnit}.`;
          if (!conflicts.includes(message)) conflicts.push(message);
        }
      }
    }
  }
  return { rules, conflicts };
}

const COLLECT_EN = /\b(?:collect|find|gather|obtain|pick up|acquire|loot|discover)\s+(?:all\s+)?(?:the\s+)?(\d+)\b/i;
const COLLECT_PT = /\b(?:colet\w*|encontr\w*|junt\w*|obt\w*|ach\w*)\s+(?:todos\s+os\s+|todas\s+as\s+)?(\d+)\b/i;

/** N of a "collect N ..." achievement text (N >= 2), or undefined. */
export function collectTarget(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const found = COLLECT_EN.exec(plain) ?? COLLECT_PT.exec(plain);
  const n = found ? Number(found[1]) : 0;
  return n >= 2 ? n : undefined;
}
