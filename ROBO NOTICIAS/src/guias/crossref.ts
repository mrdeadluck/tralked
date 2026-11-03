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

/** Sites where each page has its own author (a Steam guide, a Reddit thread): their pages are not one source. */
const MULTI_AUTHOR = /(^|\.)(steamcommunity\.com|reddit\.com|youtube\.com|youtu\.be|psnprofiles\.com)$/;

/** The site a page belongs to (host without "www."); null for multi-author sites and unparseable urls. */
function siteOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return MULTI_AUTHOR.test(host) ? null : host;
  } catch {
    return null;
  }
}

/**
 * Groups of urls that are really one source: pages of the same site (PowerPyx's roadmap and its region pages,
 * two allthings.how articles), and pages whose 5-word shingles overlap by Jaccard >= 0.6 (a copy of PowerPyx is
 * not a second opinion). On multi-author sites (Steam guides, Reddit) only the text decides. Groups keep the input
 * order; every url lands in exactly one group.
 */
export function independentGroups(pages: { url: string; text: string }[]): string[][] {
  const sets = pages.map((p) => shingles(p.text));
  const sites = pages.map((p) => siteOf(p.url));
  const parent = pages.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sameSite = sites[i] !== null && sites[i] === sites[j];
      if (sameSite || jaccard(sets[i]!, sets[j]!) >= SAME_SOURCE) parent[find(j)] = find(i);
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
  return collectGoal(text)?.target;
}

/** Words between N and the thing counted that are no part of its name ("10 full Memory Flowers"). */
const QUALIFIER = /^(?:(?:full|complete|whole|different|unique|inteir[oa]s?|complet[oa]s?|diferentes)\s+)+/i;
/** Where the name of the thing counted ends: punctuation, or a word that starts a place or a clause. */
const NOUN_END =
  /[.,;:()[\]{}!?\n]|\s(?:in|on|at|from|across|throughout|to|and|or|with|for|by|em|no|na|nos|nas|de|do|da|dos|das|e|ou|para|pelo|pela)\s/i;

/**
 * The "collect N <things>" of an achievement text: N (>= 2) and the things as written ("Sha-Chi Ambers",
 * "Accessories"), when the text names them.
 */
export function collectGoal(text: string | null | undefined): { target: number; noun?: string } | undefined {
  if (!text) return undefined;
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const found = COLLECT_EN.exec(plain) ?? COLLECT_PT.exec(plain);
  const target = found ? Number(found[1]) : 0;
  if (!found || target < 2) return undefined;
  const rest = `${plain.slice(found.index + found[0].length).trimStart().replace(QUALIFIER, "")} `;
  const end = NOUN_END.exec(rest);
  const noun = (end ? rest.slice(0, end.index) : rest).trim();
  return /\p{L}/u.test(noun) ? { target, noun } : { target };
}

/**
 * The lead clause of a how-to: up to the first colon, semicolon or end of sentence. "Complete [A], [B] and [C]:
 * bring the lily, collect 3 herbs..." asks for the three tales; the herbs are one step of one of them.
 */
export function leadClause(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  return text.split(/[:;]|\.(?:\s|$)/)[0]!.trim() || undefined;
}

/** One word in the singular, keeping its case ("Accessories" -> "Accessory", "Ambers" -> "Amber", "pétalas" -> "pétala"). */
function singularWord(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}${word.slice(-3, -2) === "I" ? "Y" : "y"}`;
  if (/(?:ches|shes|sses|xes)$/i.test(word)) return word.slice(0, -2);
  if (/ões$/i.test(word)) return `${word.slice(0, -3)}ão`;
  if (/ais$/i.test(word)) return `${word.slice(0, -2)}l`;
  if (/[^su]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** A thing's name in the singular, by its last word ("Sha-Chi Ambers" -> "Sha-Chi Amber"). */
export function singularPhrase(name: string): string {
  const words = name.trim().split(/\s+/);
  return [...words.slice(0, -1), singularWord(words.at(-1) ?? "")].join(" ");
}

/** The normalized singular, for comparing types ("Sha-Chi Ambers" and "sha-chi amber" -> "sha chi amber"). */
export const singularName = (name: string) => normalizeName(singularPhrase(normalizeName(name)));

/** The word that makes a collectible type a part of another ("Sha-Chi Amber Fragment", "Memory Flower Petal"). */
export const PART_WORDS = new Set(["fragment", "shard", "piece", "petal", "fragmento", "pedaco", "petala"]);

const UNIT_RULES: RegExp[] = [
  // "4 fragments = 1 amber", "4 shards combine into a whole Blackstone"
  /(\d+)\s*(?:x\s*)?(?:fragments?|fragmentos?|shards?|pieces?|pedacos?)\s*(?:=|->|→|equals?(?:\s+to)?|makes?|forms?|to\s+make|to\s+form|combine\s+into|combine\s+to\s+form|merge\s+into|per|for|formam|viram|valem|vale|dao)\s*(?:1|one|an?|um|uma)\b/i,
  // "每4块碎片合成1块杀气琥珀"
  /(\d+)\s*[块個个片枚份颗]?\s*(?:碎片|残片)\s*可?(?:合成|组成|合为|拼成|兑换|换成?)\s*(?:1|一)/,
  // "4 осколка = 1 янтарь"
  /(\d+)\s*(?:осколк|фрагмент)[а-яё]*\s*(?:=|→|->|—|дают|образуют|составляют|объединяются\s+в|собираются\s+в)\s*(?:1|один|одну|одно)(?![а-яё])/i,
];

/** "N fragments make one", as a source writes it (English, Portuguese, Chinese or Russian): N, or undefined. */
export function partsPerUnit(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const rule of UNIT_RULES) {
    const n = Number(rule.exec(plain)?.[1]);
    if (Number.isInteger(n) && n >= 2) return n;
  }
  return undefined;
}

const PART_RANGE =
  /(\d+)\s*(?:-|–|—|~|to|a|ate|and|e|до)\s*(\d+)\s*(?:petals?|fragments?|pieces?|shards?|parts?|petalas?|fragmentos?|partes?|лепест[а-яё]*|осколк[а-яё]*|瓣|片)/i;
const BETWEEN = /between\s+(\d+)\s+and\s+(\d+)\s+(?:in\s+each|per|each)/i;

/** "Each has 2-6 petals": the most parts one unit has, when a source says the number varies. */
export function maxPartsPerUnit(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const plain = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const found = PART_RANGE.exec(plain) ?? BETWEEN.exec(plain);
  if (!found) return undefined;
  const [min, max] = [Number(found[1]), Number(found[2])];
  return max >= 2 && min < max ? max : undefined;
}
