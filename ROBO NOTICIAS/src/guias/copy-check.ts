import type { ContentBlock } from "../tralked.js";
import type { GuidePayloadV2 } from "./contract.js";
import type { GuideDossier } from "./dossier.js";

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
 * Runs of `n` or more consecutive words of `text` that also appear, in the same order, in one of the sources
 * (case, accents and punctuation ignored). The guide checks with n = 9.
 */
export function copiedRuns(text: string, sources: readonly string[], n = 9): string[] {
  const index = ngrams(sources, n);
  const w = words(text);
  const runs: string[] = [];
  let start = -1;
  let end = -1;
  for (let i = 0; i + n <= w.length; i++) {
    if (!index.has(w.slice(i, i + n).join(" "))) continue;
    if (start >= 0 && i <= end) {
      end = i + n;
    } else {
      if (start >= 0) runs.push(w.slice(start, end).join(" "));
      start = i;
      end = i + n;
    }
  }
  if (start >= 0) runs.push(w.slice(start, end).join(" "));
  return runs;
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
): { text: string; key: string | null; kind: "copia" | "vocabulario" }[] {
  const problems: { text: string; key: string | null; kind: "copia" | "vocabulario" }[] = [];
  for (const { where, key, text } of guideProse(p)) {
    for (const run of copiedRuns(text, sources, 9)) {
      problems.push({ key, kind: "copia", text: `Trecho copiado de uma fonte em ${where}: "${run}". Reescreva com palavras próprias (no máximo 8 palavras seguidas iguais).` });
    }
    if (/platin/i.test(text)) problems.push({ key, kind: "vocabulario", text: `Em ${where}, use "Tralked" no lugar de "platina".` });
  }
  return problems;
}
