import { PART_WORDS, singularName } from "./crossref.js";
import type { ExtractedFacts } from "./facts.js";
import { normalizeName } from "./match.js";

/**
 * Did the extraction bring everything the page lists? Only for pages that number their entries ("#12 – Memory
 * Flower"): what they list is countable without a model. PowerPyx region pages also state totals ("contains 83
 * Collectible Locations", "- Sha-Chi Amber Shards: 6"), but some of their entries sit on another page (Crimson
 * Forest #69-#82 and Pangzhen #107-#161 are on the Mirage Estate page), so a total only counts up to what the page's
 * own text lists.
 */

/** The extraction must bring at least this share of the entries the page lists. */
export const COMPLETE_SHARE = 0.9;
/** A reading with more than this share of them invented or duplicated entries: it is suspect. */
export const OVERCOUNT_SHARE = 1.1;

const STATED_TOTAL = /\bcontains\s+(\d{1,4})\s+collectibles?\b|\b(\d{1,4})\s+collectibles?\s+locations?\b/i;
/** "#12 – Memory Flower", "#49 & #50 – Long Pillar (Challenge Location) / Scabbard (Accessory)". */
const ENTRY = /^#(\d{1,4})((?:\s*(?:&|,|and)\s*#\d{1,4})*)\s*[–—:-]\s*(.*)$/gm;
/** A line of the page's per-type summary: "- Sha-Chi Amber Shards: 6". */
const TYPE_LINE = /^[-*•]\s*([A-Za-z][^:\n]{1,60}):\s*(\d{1,4})\s*$/gm;

/** The numbered entries of a page: their numbers and what the line names. */
function entriesIn(text: string): { numbers: number[]; name: string }[] {
  return [...text.matchAll(ENTRY)].map((m) => ({
    numbers: [Number(m[1]), ...[...(m[2] ?? "").matchAll(/#(\d{1,4})/g)].map((n) => Number(n[1]))],
    name: m[3] ?? "",
  }));
}

/**
 * How many entries a page lists, when it numbers them: the numbers its text holds, capped by the total it states.
 * "Contains 161" with only #1..#106 on the page is 106. A page without numbered entries gives none.
 */
export function statedEntries(text: string): number | undefined {
  const numbers = new Set(entriesIn(text).flatMap((e) => e.numbers));
  if (numbers.size === 0) return undefined;
  const found = STATED_TOTAL.exec(text);
  const stated = found ? Number(found[1] ?? found[2]) : NaN;
  return stated > 0 ? Math.min(stated, numbers.size) : numbers.size;
}

/** A thing's words in the singular, any "fragment / shard / piece / petal" as "fragment". */
const canonical = (text: string) =>
  new Set(
    normalizeName(text)
      .split(" ")
      .map((w) => singularName(w))
      .map((w) => (PART_WORDS.has(w) ? "fragment" : w)),
  );
const labelParts = (label: string) => label.split(/\s*(?:&|,|\band\b)\s*/i).map((p) => [...canonical(p)]).filter((p) => p.length > 0);
const names = (label: string, text: string) => {
  const words = canonical(text);
  return labelParts(label).some((part) => part.every((w) => words.has(w)));
};

/** Whether a collectible type ("Sha-Chi Amber Fragment") is one of a summary label's ("Sha-Chi Amber Shards"). */
export const labelNamesType = (label: string, type: string) => names(label, type);

/** The things the numbered entries name: "#30 & #31 – Memory Flower / Sha-Chi Amber Fragment" is two. */
const thingsIn = (text: string) => entriesIn(text).flatMap((e) => e.name.split(/\s+\/\s+/).map((t) => t.trim()).filter(Boolean));
/** A thing's own name, without its type label and warnings ("Calming Gourd (Accessory) – MISSABLE" -> "calming gourd"). */
const core = (name: string) => normalizeName(name.replace(/\([^)]*\)/g, " ").replace(/\s[–—-]\s*MISSABLE.*$/i, " "));

/**
 * The page's per-type summary ("- Sha-Chi Amber Shards: 6"), each with the things of the page's own numbered entries
 * of that type; the total is capped by them (the rest is on another page).
 */
function typedThings(text: string): { label: string; stated: number; things: string[] }[] {
  const first = /^#\d{1,4}\s*[–—:&,-]/m.exec(text);
  const head = first ? text.slice(0, first.index) : text.slice(0, 3000);
  const things = thingsIn(text);
  return [...head.matchAll(TYPE_LINE)]
    .map((m) => {
      const label = m[1]!.trim();
      const listed = things.filter((t) => names(label, t));
      return { label, stated: Math.min(Number(m[2]), listed.length), things: listed };
    })
    .filter((t) => t.stated > 0);
}

/** The page's per-type totals, capped by what its own numbered entries list. */
export const statedTypes = (text: string) => typedThings(text).map(({ label, stated }) => ({ label, stated }));

export type TypeShortfall = { label: string; stated: number; extracted: number };
export type Completeness = {
  stated: number;
  /** The extraction's collectibles (key items and quest steps are not numbered entries). */
  extracted: number;
  /** Under 90% of the entries, or under the total of some type. */
  short: boolean;
  /** Over 110% of the entries: invented or duplicated entries. */
  over: boolean;
  types: TypeShortfall[];
};

/** What a page lists against what its extraction brought; undefined for a page without numbered entries. */
export function completeness(text: string, facts: Pick<ExtractedFacts, "chapters">): Completeness | undefined {
  const stated = statedEntries(text);
  if (stated === undefined) return undefined;
  const items = facts.chapters.flatMap((c) => c.items);
  const extracted = items.filter((i) => i.kind === "collectible").length;
  // Each listed thing of a type needs an extracted item of its own name (the model's type labels vary: "Healing").
  const types = typedThings(text)
    .map(({ label, stated: total, things }) => {
      const pool = items.flatMap((i) => (i.nameEn ?? i.name).split(/\s+\/\s+/).map(core)).filter(Boolean);
      let found = 0;
      for (const thing of things.map(core)) {
        const at = pool.findIndex((c) => c === thing || (thing.length >= 3 && (c.includes(thing) || thing.includes(c))));
        if (at < 0) continue;
        pool.splice(at, 1);
        found++;
      }
      return { label, stated: total, extracted: Math.min(found, total) };
    })
    .filter((t) => t.extracted < t.stated);
  return { stated, extracted, short: extracted < COMPLETE_SHARE * stated || types.length > 0, over: extracted > OVERCOUNT_SHARE * stated, types };
}

/** The verdict on the facts: `shortfall` (incomplete) and / or `suspect` (more entries than the page lists). */
export function withVerdict(facts: ExtractedFacts, c: Completeness): ExtractedFacts {
  return {
    ...facts,
    ...(c.short ? { shortfall: { stated: c.stated, extracted: c.extracted, ...(c.types.length > 0 ? { types: c.types } : {}) } } : {}),
    ...(c.over ? { suspect: { stated: c.stated, extracted: c.extracted } } : {}),
  };
}
