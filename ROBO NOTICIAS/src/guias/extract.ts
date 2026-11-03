import { readFileSync } from "node:fs";
import type { Ai } from "../ai/client.js";
import { llmFactsSchema, type ExtractedFacts, type LlmFacts } from "./facts.js";
import type { SourceRef } from "./sources.js";

export const CHUNK_CHARS = 60_000;

export interface ExtractDeps {
  ai: Ai;
  /** `MODEL_EXTRACT` from the guide-robot config. */
  model: string;
  bucket?: "live" | "backfill";
}

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

function merge(source: SourceRef, parts: LlmFacts[]): ExtractedFacts {
  const first = parts[0]!;
  const chapters = parts.flatMap((p) => p.chapters).map((c, i) => ({ ...c, order: i + 1 }));
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
    // The "work in progress / covers 100%" notice sits at the top of the page, i.e. in the first part.
    complete: first.complete,
  };
}

export async function extractFacts(
  page: { url: string; text: string; html?: string },
  source: SourceRef,
  deps: ExtractDeps,
): Promise<ExtractedFacts> {
  const chunks = splitText(page.text);
  const system = extractionPrompt();
  const parts: LlmFacts[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const header =
      `Source: ${source.name} (${page.url}), role ${source.role}.` +
      (chunks.length > 1 ? ` This is part ${i + 1} of ${chunks.length} of the page; extract only what is in this part.` : "");
    parts.push(
      await deps.ai.structured({
        bucket: deps.bucket ?? "backfill",
        purpose: `guia-extracao:${source.name}:${i + 1}/${chunks.length}`,
        model: deps.model,
        effort: "medium",
        system,
        user: `${header}\n\n${chunk}`,
        schema: llmFactsSchema,
        maxTokens: 32000,
      }),
    );
  }
  return merge(source, parts);
}
