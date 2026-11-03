import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Ai, StructuredOpts } from "../../src/ai/client.js";
import { completeness, statedEntries } from "../../src/guias/completeness.js";
import { extractFacts, extractionPrompt, RETRY_NOTE, splitText } from "../../src/guias/extract.js";
import { extractedFactsSchema, llmFactsSchema, type LlmFacts } from "../../src/guias/facts.js";
import type { SourceRef } from "../../src/guias/sources.js";

const source: SourceRef = { name: "PowerPyx", url: "https://www.powerpyx.com/x/", role: "roteiro_psn", language: "en" };

const base: LlmFacts = { chapters: [], achievements: [], platform: "unknown", claimsComplete: true, workInProgress: false };

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

  it("Task 25: o esforço da extração vem da config (padrão medium, 32k de saída; high e acima: 64k, por streaming)", async () => {
    const page = { url: source.url, text: "Some guide text.", html: "" };
    const medium = fakeAi(() => base);
    await extractFacts(page, source, { ai: medium.ai, model: "claude-sonnet-5-5" });
    expect(medium.calls[0]).toMatchObject({ effort: "medium", maxTokens: 32000 });
    const high = fakeAi(() => base);
    await extractFacts(page, source, { ai: high.ai, model: "claude-opus-5-5", effort: "high" });
    expect(high.calls[0]).toMatchObject({ model: "claude-opus-5-5", effort: "high", maxTokens: 64000 });
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

  it("guarda o grau do troféu (a linha da tabela traz | Platinum): a platina de nome temático é reconhecida", async () => {
    const trophy = (nameEn: string, grade: "platinum" | "gold" | "silver" | "bronze") => ({
      nameEn,
      howTo: "x",
      missable: false,
      bugged: false,
      online: false,
      grade,
    });
    const { ai } = fakeAi(() => ({
      ...base,
      platform: "psn",
      achievements: [trophy("Master of the Phantom Blade", "platinum"), trophy("Platinum Edge", "bronze")],
    }));
    const facts = await extractFacts(
      { url: source.url, text: "Master of the Phantom Blade | Platinum | Obtain all trophies\nPlatinum Edge | Bronze | Upgrade", html: "<p>x</p>" },
      source,
      { ai, model: "claude-sonnet-5-5" },
    );
    expect(facts.achievements.map((a) => [a.nameEn, a.grade])).toEqual([
      ["Master of the Phantom Blade", "platinum"],
      ["Platinum Edge", "bronze"],
    ]);
    expect(extractedFactsSchema.safeParse(facts).success).toBe(true);
    expect(llmFactsSchema.safeParse({ ...base, achievements: [{ ...trophy("x", "gold"), grade: "diamond" }] }).success).toBe(false);
    expect(extractionPrompt()).toMatch(/`grade`[^\n]*platinum[^\n]*Platinum/);
  });

  it("rejeita resposta fora do schema", () => {
    expect(llmFactsSchema.safeParse({ ...base, platform: "xbox" }).success).toBe(false);
  });
  it("junta o capítulo cortado na fronteira entre partes, mantendo a ordem dos itens", async () => {
    const text = `${"a".repeat(59_000)}
${"b".repeat(5000)}`;
    const item = (name: string): LlmFacts["chapters"][number]["items"][number] => ({
      kind: "collectible", name, location: "x", missable: false, returnLater: false, countsForEn: [],
    });
    const { ai } = fakeAi((_o, i) =>
      i === 0
        ? { ...base, chapters: [chapter("Intro"), { title: "Crimson Forest", region: "Crimson Forest", order: 2, items: [item("A"), item("B")] }] }
        : { ...base, chapters: [{ title: "crimson forest ", region: "Crimson Forest", order: 1, items: [item("C")] }, chapter("Meigu Lake")] },
    );
    const facts = await extractFacts({ url: source.url, text }, source, { ai, model: "claude-sonnet-5-5" });
    expect(facts.chapters.map((c) => c.title)).toEqual(["Intro", "Crimson Forest", "Meigu Lake"]);
    expect(facts.chapters[1]!.items.map((i) => i.name)).toEqual(["A", "B", "C"]);
    expect(facts.chapters.map((c) => c.order)).toEqual([1, 2, 3]);
  });

  describe("complete: juntando as partes de uma página longa", () => {
    const longText = `${"a".repeat(59_000)}
${"b".repeat(59_000)}
${"c".repeat(5000)}`;
    const run = async (flags: { claimsComplete: boolean; workInProgress: boolean }[]) => {
      const { ai } = fakeAi((_o, i) => ({ ...base, ...flags[i]! }));
      return extractFacts({ url: source.url, text: longText }, source, { ai, model: "claude-sonnet-5-5" });
    };
    const claim = { claimsComplete: true, workInProgress: false };
    const silent = { claimsComplete: false, workInProgress: false };
    const wip = { claimsComplete: false, workInProgress: true };

    it("o autor diz 100% numa parte e nenhuma parte diz WIP → completa", async () => {
      expect((await run([claim, silent, silent])).complete).toBe(true);
      // The full trophy table can sit at the end of the page.
      expect((await run([silent, silent, claim])).complete).toBe(true);
    });

    it("uma parte diz que o guia não está pronto → incompleta, mesmo com a promessa de 100% no topo", async () => {
      expect((await run([claim, silent, wip])).complete).toBe(false);
    });

    it("ninguém diz 100% → incompleta", async () => {
      expect((await run([silent, silent, silent])).complete).toBe(false);
    });
  });

  it("o prompt separa a promessa de 100% do aviso de WIP: 'sendo atualizado' e 'falta confirmar' são WIP, 'aceito correções' não", () => {
    const prompt = extractionPrompt();
    expect(prompt).toMatch(/`claimsComplete`/);
    expect(prompt).toMatch(/全成就/);
    const wip = prompt.slice(prompt.indexOf("`workInProgress`"));
    expect(wip).toMatch(/being updated/);
    expect(wip).toMatch(/дополняется/);
    expect(wip).toMatch(/not yet confirmed/);
    expect(wip).toMatch(/NOT work in progress[^.]*corrections are welcome/);
  });
});


describe("extração completa: a página numera as entradas (Village of Lu, cache real)", () => {
  const lu: SourceRef = {
    name: "PowerPyx (Village Of Lu)",
    url: "https://www.powerpyx.com/phantom-blade-zero-village-of-lu-collectible-locations/",
    role: "coletaveis",
    language: "en",
  };
  const text = readFileSync(new URL("./fixtures/powerpyx-pbz-village-of-lu.txt", import.meta.url), "utf8");
  type Item = LlmFacts["chapters"][number]["items"][number];
  /** What a faithful model returns for a text: one item per numbered entry ("#30 & #31 – A / B" is two). */
  const entriesIn = (user: string): Item[] =>
    [...user.matchAll(/^#(\d+)((?:\s*&\s*#\d+)*)\s*[–-]\s*(.+)$/gm)].flatMap((m) => {
      const count = 1 + (m[2]!.match(/#/g)?.length ?? 0);
      const names = m[3]!.split(" / ");
      return Array.from({ length: count }, (_, i) => ({
        kind: "collectible", name: (names[i] ?? names[0]!).trim(), location: "x", missable: false, returnLater: false, countsForEn: [],
      }));
    });
  const answer = (items: Item[]): LlmFacts => ({ ...base, chapters: [{ title: "First Visit", region: "Village of Lu", order: 1, items }] });

  it("entradas da página: os números que o texto traz, limitados ao total declarado; hub sem entradas numeradas não conta", () => {
    // "Contains 76", but the text holds 75 numbers (#30 & #31 share a line; one number is not on the page).
    expect(statedEntries(text)).toBe(75);
    expect(statedEntries("Phantom Blade Zero contains 564 Collectibles Locations (161 Bells, ...). By region: ...")).toBeUndefined();
    expect(statedEntries("#1 – Bell\nx\n#2 – Memory Flower\ny\n#3 – Bell")).toBe(3);
  });

  it("Pangzhen: 161 declarados, mas a página só numera #1..#106 (o resto está na Mirage Estate) → 106", () => {
    const page = `Pangzhen is the 4th region and contains 161 Collectible Locations.\n${Array.from({ length: 106 }, (_, i) => `#${i + 1} – Bell (Spot ${i + 1})\nWhere it is.`).join("\n")}`;
    expect(statedEntries(page)).toBe(106);
    const items = Array.from({ length: 100 }, (_, i) => ({ kind: "collectible", name: `Bell (Spot ${i + 1})`, location: "x", missable: false, returnLater: false, countsForEn: [] }));
    expect(completeness(page, { chapters: [{ title: "First Visit", order: 1, items }] })).toMatchObject({ stated: 106, extracted: 100, short: false });
  });

  it("veio curta (18 de 75): relê em partes menores, com a regra de listar cada entrada numerada, e fica com a lista inteira", async () => {
    const { ai, calls } = fakeAi((opts, i) => (i === 0 ? answer(entriesIn(opts.user).slice(0, 18)) : answer(entriesIn(opts.user))));
    const facts = await extractFacts({ url: lu.url, text }, lu, { ai, model: "claude-sonnet-5-5" });
    // One first pass, then the page again in parts of at most 15k characters (and always at least two).
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const retries = calls.slice(1);
    expect(retries.every((c) => c.user.includes(RETRY_NOTE))).toBe(true);
    expect(calls[0]!.user).not.toContain(RETRY_NOTE);
    expect(RETRY_NOTE).toMatch(/EVERY numbered entry/);
    expect(retries.every((c) => c.purpose.startsWith("guia-extracao:"))).toBe(true);
    expect(facts.chapters.flatMap((c) => c.items)).toHaveLength(75);
    expect(facts.shortfall).toBeUndefined();
    expect(facts.suspect).toBeUndefined();
    expect(extractedFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("continua curta depois de reler: a fonte fica marcada como incompleta (para o relatório e a porta)", async () => {
    const { ai, calls } = fakeAi((opts) => answer(entriesIn(opts.user).slice(0, 9)));
    const facts = await extractFacts({ url: lu.url, text }, lu, { ai, model: "claude-sonnet-5-5" });
    expect(calls.length - 1).toBeGreaterThanOrEqual(2);
    const extracted = facts.chapters.flatMap((c) => c.items).length;
    expect(extracted).toBe(calls.slice(1).reduce((n, c) => n + Math.min(9, entriesIn(c.user).length), 0));
    expect(facts.shortfall).toMatchObject({ stated: 75, extracted });
    expect(extracted).toBeLessThan(0.9 * 75);
  });

  it("veio completa: nenhuma releitura", async () => {
    const { ai, calls } = fakeAi((opts) => answer(entriesIn(opts.user)));
    const facts = await extractFacts({ url: lu.url, text }, lu, { ai, model: "claude-sonnet-5-5" });
    expect(calls).toHaveLength(1);
    expect(facts.shortfall).toBeUndefined();
  });

  it("total geral passa de 90% mas falta um tipo do resumo da página (Sha-Chi Amber Shards): relê em partes", async () => {
    // 74 of 75 entries (99%), but the one left out is a Sha-Chi Amber Fragment.
    const dropShard = (items: Item[]) => {
      const at = items.findIndex((x) => x.name.startsWith("Sha-Chi Amber Fragment"));
      return items.filter((_, i) => i !== at);
    };
    const short = fakeAi((opts) => answer(dropShard(entriesIn(opts.user))));
    const facts = await extractFacts({ url: lu.url, text }, lu, { ai: short.ai, model: "claude-sonnet-5-5" });
    expect(short.calls.length).toBeGreaterThanOrEqual(3);
    expect(facts.shortfall).toMatchObject({ stated: 75, types: [{ label: "Sha-Chi Amber Shards", stated: 4, extracted: 3 }] });

    const fixed = fakeAi((opts, i) => answer(i === 0 ? dropShard(entriesIn(opts.user)) : entriesIn(opts.user)));
    const again = await extractFacts({ url: lu.url, text }, lu, { ai: fixed.ai, model: "claude-sonnet-5-5" });
    expect(fixed.calls.length).toBeGreaterThanOrEqual(3);
    expect(again.shortfall).toBeUndefined();
  });

  it("'mais itens ganha' tem teto: uma releitura acima de 110% das entradas não é usada; sozinha acima, fica marcada como suspeita", async () => {
    const doubled = fakeAi((opts, i) => answer(i === 0 ? entriesIn(opts.user).slice(0, 18) : [...entriesIn(opts.user), ...entriesIn(opts.user)]));
    const facts = await extractFacts({ url: lu.url, text }, lu, { ai: doubled.ai, model: "claude-sonnet-5-5" });
    expect(facts.chapters.flatMap((c) => c.items)).toHaveLength(18);
    expect(facts.shortfall).toMatchObject({ stated: 75, extracted: 18 });
    expect(facts.suspect).toBeUndefined();

    const over = fakeAi((opts) => answer([...entriesIn(opts.user), ...entriesIn(opts.user).slice(0, 20)]));
    const suspect = await extractFacts({ url: lu.url, text }, lu, { ai: over.ai, model: "claude-sonnet-5-5" });
    expect(over.calls).toHaveLength(1);
    expect(suspect.suspect).toEqual({ stated: 75, extracted: 95 });
  });

  it("o prompt manda listar cada entrada numerada, sem resumir", () => {
    expect(extractionPrompt()).toMatch(/every numbered entry/i);
  });
});
