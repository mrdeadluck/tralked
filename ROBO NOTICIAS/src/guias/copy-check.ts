import type { ContentBlock } from "../tralked.js";
import type { GuidePayloadV2 } from "./contract.js";
import { targetNames, type GuideDossier } from "./dossier.js";

/**
 * Deterministic checks of the written guide, run before the LLM checker: copied runs of 9+ words (the manual allows
 * at most 8 equal words in a row) and the vocabulary ("Tralked", never "platina").
 */

const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const ngramCache = new WeakMap<readonly string[], Map<number, Set<string>>>();

function ngrams(sources: readonly string[], n: number): Set<string> {
  let byN = ngramCache.get(sources);
  if (!byN) ngramCache.set(sources, (byN = new Map()));
  let set = byN.get(n);
  if (!set) {
    set = new Set();
    for (const source of sources) {
      const w = words(source);
      for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" "));
    }
    byN.set(n, set);
  }
  return set;
}

/**
 * Task 23: a known name's word sequences: the whole name, and its parts cut at the separators names use ("Boss: Meng
 * Hua, the Merciful Lady of the Blossom Veil", "Memory Flower – Xuan Li’s Memory Flower – 6. Control"). Only
 * sequences of 2+ words: a single word ("the", "control") is never taken for a name.
 */
function nameSequences(names: readonly string[]): string[][] {
  const out = new Map<string, string[]>();
  for (const name of names) {
    for (const part of [name, ...name.split(/\s*[,:;|/()[\]–—]\s*|\s+-\s+|\.\s+/)]) {
      const w = words(part);
      if (w.length >= 2) out.set(w.join(" "), w);
    }
  }
  return [...out.values()];
}

/** For each word of `w`: true when it belongs to an occurrence of one of the names' word sequences. */
function nameMask(w: readonly string[], names: readonly string[]): boolean[] {
  const mask = w.map(() => false);
  for (const seq of nameSequences(names)) {
    for (let i = 0; i + seq.length <= w.length; i++) {
      if (seq.every((word, k) => w[i + k] === word)) for (let k = 0; k < seq.length; k++) mask[i + k] = true;
    }
  }
  return mask;
}

/**
 * Runs of `n` or more consecutive words of `text` that also appear, in the same order, in one of the sources
 * (case, accents and punctuation ignored). The guide checks with n = 9. Task 23: the guide must cite proper names,
 * which repeat the sources; a run counts only when, without the words of the known `names` (`knownNames`), it still
 * has `n` or more equal words in a row.
 */
export function copiedRuns(text: string, sources: readonly string[], n = 9, names: readonly string[] = []): string[] {
  const index = ngrams(sources, n);
  const w = words(text);
  const named = names.length > 0 ? nameMask(w, names) : w.map(() => false);
  const runs: string[] = [];
  const push = (start: number, end: number) => {
    let longest = 0;
    for (let i = start, len = 0; i < end; i++) longest = Math.max(longest, (len = named[i] ? 0 : len + 1));
    if (longest >= n) runs.push(w.slice(start, end).join(" "));
  };
  let start = -1;
  let end = -1;
  for (let i = 0; i + n <= w.length; i++) {
    if (!index.has(w.slice(i, i + n).join(" "))) continue;
    if (start >= 0 && i <= end) {
      end = i + n;
    } else {
      if (start >= 0) push(start, end);
      start = i;
      end = i + n;
    }
  }
  if (start >= 0) push(start, end);
  return runs;
}

/**
 * Task 23: the proper names the dossier knows, which the guide must cite: items' names (and English names and
 * collectible types), achievements' names (English and PT-BR), chapter titles, regions, and the bosses, NPCs and
 * quests the achievements' texts and the milestones cite (`targetNames`).
 */
export function knownNames(dossier: GuideDossier): string[] {
  const names = [
    ...dossier.chapters.flatMap((c) => [
      c.title,
      c.region ?? "",
      ...c.items.flatMap((i) => [i.name, i.nameEn ?? "", i.collectibleType ?? "", ...targetNames(i.missableUntil)]),
    ]),
    ...dossier.achievements.flatMap((a) => [
      a.nameEn,
      a.namePt ?? "",
      ...[a.description, a.descriptionPt, a.howTo, a.missableUntil].flatMap((t) => targetNames(t)),
    ]),
  ];
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
}

/** The texts the dossier carries from the sources: what the guide may not copy when the raw pages are not given. */
export function dossierTexts(dossier: GuideDossier): string[] {
  return [
    ...dossier.chapters.flatMap((c) => c.items.map((i) => i.location)),
    ...dossier.achievements.flatMap((a) => [a.howTo ?? "", a.bugNote ?? ""]),
    ...dossier.facts.roadmap.map((r) => r.summary),
    dossier.facts.playthroughs?.value.note ?? "",
    dossier.facts.difficulty?.value.note ?? "",
  ].filter((t) => t.trim().length > 0);
}

const blockText = (b: ContentBlock) => (b.type === "paragraph" || b.type === "callout" ? b.text : "");

/**
 * Every text the model wrote, with where it is and the walkthrough key it belongs to (a step or item key; null for
 * the frame: cover, ficha, overview, read-first, roadmap, chapter titles). Names are left out: they repeat the
 * sources on purpose.
 */
export function guideProse(p: GuidePayloadV2): { where: string; key: string | null; text: string }[] {
  const w = p.walkthrough;
  return [
    { where: "a capa", key: null, text: `${w.cover.headline}. ${w.cover.deck}` },
    { where: "a ficha", key: null, text: `${w.extraFacts.playthroughsNote} ${w.extraFacts.difficultyNote}` },
    ...(p.overview ?? []).map((text) => ({ where: "a visão geral", key: null, text })),
    ...w.readFirst.map((r) => ({ where: `o "leia antes" "${r.title}"`, key: null, text: `${r.title}. ${r.text}` })),
    ...p.steps.flatMap((s) => s.body.map((b) => ({ where: `a etapa ${s.key ?? s.title}`, key: null, text: blockText(b) }))),
    ...w.chapters.flatMap((c) => [
      { where: `o capítulo ${c.key}`, key: null, text: `${c.title}. ${c.deadline ?? ""}` },
      ...c.steps.flatMap((s) => [
        ...s.body.map((b) => ({ where: `o passo ${s.key}`, key: s.key, text: blockText(b) })),
        ...s.items.map((i) => ({ where: `o item ${i.key}`, key: i.key, text: i.location ?? "" })),
      ]),
    ]),
  ].filter((x) => x.text.trim().length > 0);
}

/** Copy (9+ equal words) and vocabulary ("platina") problems, in Portuguese, one per finding, with their key. */
export function deterministicProblems(
  p: GuidePayloadV2,
  sources: readonly string[],
  names: readonly string[] = [],
): { text: string; key: string | null; kind: "copia" | "vocabulario" }[] {
  const problems: { text: string; key: string | null; kind: "copia" | "vocabulario" }[] = [];
  for (const { where, key, text } of guideProse(p)) {
    for (const run of copiedRuns(text, sources, 9, names)) {
      problems.push({ key, kind: "copia", text: `Trecho copiado de uma fonte em ${where}: "${run}". Reescreva com palavras próprias (no máximo 8 palavras seguidas iguais).` });
    }
    if (/platin/i.test(text)) problems.push({ key, kind: "vocabulario", text: `Em ${where}, use "Tralked" no lugar de "platina".` });
  }
  return problems;
}
