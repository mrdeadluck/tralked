import { describe, expect, it, vi } from "vitest";
import type { Ai, StructuredOpts } from "../../src/ai/client.js";
import { extractFacts, splitText } from "../../src/guias/extract.js";
import { extractedFactsSchema, llmFactsSchema, type LlmFacts } from "../../src/guias/facts.js";
import type { SourceRef } from "../../src/guias/sources.js";

const source: SourceRef = { name: "PowerPyx", url: "https://www.powerpyx.com/x/", role: "roteiro_psn", language: "en" };

const base: LlmFacts = { chapters: [], achievements: [], platform: "unknown", complete: true };

function fakeAi(responder: (opts: StructuredOpts<unknown>, call: number) => unknown) {
  const calls: StructuredOpts<unknown>[] = [];
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    return llmFactsSchema.parse(responder(opts, calls.length - 1));
  });
  const ai = { structured, batchRequest: vi.fn(), recordBatchUsage: vi.fn(), assertBudget: vi.fn() } as unknown as Ai;
  return { ai, calls };
}

const chapter = (title: string): LlmFacts["chapters"][number] => ({ title, order: 1, items: [] });

describe("extractFacts", () => {
  it("divide página grande em partes e mantém a ordem dos capítulos", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(120_000);

    const parts = splitText(text);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.every((p) => p.length <= 60_000)).toBe(true);
    expect(parts.join("")).toBe(text);

    const { ai, calls } = fakeAi((_o, i) => ({
      ...base,
      chapters: [chapter(`Chapter ${i + 1}`)],
      achievements: [{ nameEn: "Same", howTo: "h", missable: false, bugged: false, online: false }],
    }));
    const facts = await extractFacts({ url: source.url, text, html: "" }, source, { ai, model: "claude-sonnet-5-5" });

    expect(calls).toHaveLength(parts.length);
    calls.forEach((c, i) => expect(c.user).toContain(parts[i]!));
    expect(calls.every((c) => c.effort === "medium" && c.model === "claude-sonnet-5-5")).toBe(true);
    expect(facts.chapters.map((c) => c.title)).toEqual(parts.map((_, i) => `Chapter ${i + 1}`));
    expect(facts.chapters.map((c) => c.order)).toEqual(parts.map((_, i) => i + 1));
    expect(facts.achievements).toHaveLength(1);
    expect(facts.source).toEqual(source);
    expect(extractedFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("marca platform psn quando a página fala em PS5/troféus e trophyListSize 36", async () => {
    const { ai, calls } = fakeAi(() => ({ ...base, platform: "psn", trophyListSize: 36 }));
    const facts = await extractFacts(
      { url: source.url, text: "PS5 trophy guide. 36 trophies in total.", html: "<p>x</p>" },
      source,
      { ai, model: "claude-sonnet-5-5" },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toMatch(/only what is written/i);
    expect(facts.platform).toBe("psn");
    expect(facts.trophyListSize).toBe(36);
    expect(facts.complete).toBe(true);
  });

  it("rejeita resposta fora do schema", () => {
    expect(llmFactsSchema.safeParse({ ...base, platform: "xbox" }).success).toBe(false);
  });
});
