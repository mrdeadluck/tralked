import { readFileSync } from "node:fs";
import type { Ai, Effort } from "../ai/client.js";
import { completeness, withVerdict } from "./completeness.js";
import { llmFactsSchema, type ExtractedFacts, type LlmFacts } from "./facts.js";
import type { SourceRef } from "./sources.js";

export const CHUNK_CHARS = 60_000;

export interface ExtractDeps {
  ai: Ai;
  /** `MODEL_EXTRACT` from the guide-robot config. */
  model: string;
  /** `EXTRACT_EFFORT` (Task 25); medium when absent. */
  effort?: Effort;
  bucket?: "live" | "backfill";
}

/**
 * Output room of one extraction call: the facts of a 60k-character part plus the adaptive thinking (billed as output,
 * more of it with more effort). Up to medium, 32k (what every extraction so far needed); above, 64k. Both are
 * streamed by the client (over its non-streaming limit); only the tokens used are paid.
 */
export const extractMaxTokens = (effort: Effort) => (effort === "low" || effort === "medium" ? 32_000 : 64_000);

let promptCache: string | undefined;
export function extractionPrompt(): string {
  promptCache ??= readFileSync(new URL("../../prompts/guia-extracao.md", import.meta.url), "utf8");
  return promptCache;
}

/** Splits at line breaks when possible so no sentence is cut; the parts joined in order give the original text. */
export function splitText(text: string, size = CHUNK_CHARS): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    cut = cut < size * 0.5 ? size : cut + 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0 || parts.length === 0) parts.push(rest);
  return parts;
}

type Chapter = LlmFacts["chapters"][number];
const sameChapter = (a: Chapter, b: Chapter) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  (a.region ?? "").trim().toLowerCase() === (b.region ?? "").trim().toLowerCase();

/** A chapter cut by a part boundary comes back as two chapters with the same title: join them, items in order. */
function joinChapters(parts: LlmFacts[]): Chapter[] {
  const out: Chapter[] = [];
  parts.forEach((p, i) => {
    p.chapters.forEach((c, j) => {
      const last = out[out.length - 1];
      if (i > 0 && j === 0 && last && sameChapter(last, c)) last.items = [...last.items, ...c.items];
      else out.push({ ...c });
    });
  });
  return out;
}

/**
 * A long page is read in parts, and the author's "covers all N achievements" can sit in any of them (the title at
 * the top, the full trophy table at the end), as can a "still writing this" note. Complete = some part claims it
 * and no part says it is unfinished.
 */
export function mergeComplete(parts: Pick<LlmFacts, "claimsComplete" | "workInProgress">[]): boolean {
  return parts.some((p) => p.claimsComplete) && !parts.some((p) => p.workInProgress);
}

function merge(source: SourceRef, parts: LlmFacts[]): ExtractedFacts {
  const chapters = joinChapters(parts).map((c, i) => ({ ...c, order: i + 1 }));
  const seen = new Set<string>();
  const achievements = parts
    .flatMap((p) => p.achievements)
    .filter((a) => {
      const k = a.nameEn.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const playthroughs = parts.find((p) => p.playthroughs)?.playthroughs;
  const difficulty = parts.find((p) => p.difficulty)?.difficulty;
  const hours = parts.find((p) => p.hours)?.hours;
  const trophyListSize = parts.find((p) => p.trophyListSize !== undefined)?.trophyListSize;
  const roadmap = parts.flatMap((p) => p.roadmap ?? []);
  return {
    source,
    chapters,
    achievements,
    ...(playthroughs ? { playthroughs } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(hours ? { hours } : {}),
    ...(roadmap.length ? { roadmap } : {}),
    ...(trophyListSize !== undefined ? { trophyListSize } : {}),
    platform: parts.find((p) => p.platform !== "unknown")?.platform ?? "unknown",
    complete: mergeComplete(parts),
  };
}

/** A page whose extraction came back short is read again in parts of at most this many characters (two at least). */
export const RETRY_CHUNK_CHARS = 15_000;
/** Added to each part of the second reading. */
export const RETRY_NOTE =
  "This page was read before and entries were lost. List EVERY numbered entry of this part as its own item, in page order; do not summarize, merge or skip entries.";

async function readParts(
  page: { url: string; text: string },
  source: SourceRef,
  deps: ExtractDeps,
  chunks: string[],
  again: boolean,
): Promise<LlmFacts[]> {
  const system = extractionPrompt();
  const parts: LlmFacts[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const header =
      `Source: ${source.name} (${page.url}), role ${source.role}.` +
      (chunks.length > 1 ? ` This is part ${i + 1} of ${chunks.length} of the page; extract only what is in this part.` : "") +
      (again ? `\n\n${RETRY_NOTE}` : "");
    parts.push(
      await deps.ai.structured({
        bucket: deps.bucket ?? "backfill",
        purpose: `guia-extracao:${source.name}:${again ? "releitura " : ""}${i + 1}/${chunks.length}`,
        model: deps.model,
        effort: deps.effort ?? "medium",
        system,
        user: `${header}\n\n${chunk}`,
        schema: llmFactsSchema,
        maxTokens: extractMaxTokens(deps.effort ?? "medium"),
      }),
    );
  }
  return parts;
}

/**
 * The facts of a page. When the page numbers its entries and the extraction brought less than 90% of them, or less
 * than the page's total of some type (the model summarized a long list: PowerPyx's Village of Lu, 76 entries, came
 * back with 18), the page is read once more in smaller parts with an explicit "list every numbered entry". The
 * reading with more entries wins, but only up to 110% of what the page lists (more is invented or duplicated); when
 * both pass that, the smaller one is kept and marked `suspect`. Still short: `shortfall` marks the source incomplete.
 */
export async function extractFacts(
  page: { url: string; text: string; html?: string },
  source: SourceRef,
  deps: ExtractDeps,
): Promise<ExtractedFacts> {
  const firstParts = await readParts(page, source, deps, splitText(page.text), false);
  const first = merge(source, firstParts);
  const checked = completeness(page.text, first);
  if (!checked) return first;
  if (!checked.short) return withVerdict(first, checked);

  const size = Math.min(RETRY_CHUNK_CHARS, Math.ceil(page.text.length / 2));
  const againParts = await readParts(page, source, deps, splitText(page.text, size), true);
  // The second reading's chapters; the first one's achievements and facts too (the roadmap only once).
  const hasRoadmap = againParts.some((p) => (p.roadmap?.length ?? 0) > 0);
  const again = merge(source, [...againParts, ...firstParts.map((p) => ({ ...p, chapters: [], ...(hasRoadmap ? { roadmap: [] } : {}) }))]);
  const readings = [
    { facts: first, c: checked },
    { facts: again, c: completeness(page.text, again)! },
  ];
  const sane = readings.filter((r) => !r.c.over);
  const best =
    sane.length > 0
      ? sane.reduce((a, b) => (b.c.extracted > a.c.extracted ? b : a))
      : readings.reduce((a, b) => (b.c.extracted < a.c.extracted ? b : a));
  return withVerdict(best.facts, best.c);
}
