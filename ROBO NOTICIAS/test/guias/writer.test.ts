import { describe, expect, it, vi } from "vitest";
import { guidePayloadSchema } from "@/lib/content/guide-schema";
import { walkAchievementRefs, walkItemKeys, walkthroughSchema } from "@/lib/content/walkthrough-schema";
import type { Ai, StructuredOpts } from "../../src/ai/client.js";
import { checkGuide } from "../../src/guias/checker.js";
import type { GuidePayloadV2 } from "../../src/guias/contract.js";
import { buildDossier, type GuideDossier, type GuideDossierSource, type SteamAchievement } from "../../src/guias/dossier.js";
import { copiedRuns, loadGuideStyle, writeAndCheckGuide, writeGuide, writeGuideDetailed } from "../../src/guias/writer.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";

const STEAM: SteamAchievement[] = [
  { ...steamAch("ACH_BELLS", "Bell Ringer", "Ring 2 bells."), namePt: "Sineiro", descriptionPt: "Toque 2 sinos." },
  { ...steamAch("ACH_WARDEN", "Warden Down", "Defeat the Warden.", true), namePt: "Fim do Guardião", globalPct: 3 },
  { ...steamAch("ACH_ENDING", "The End", "Finish the story."), globalPct: 40 },
  { ...steamAch("ACH_SECRET", "Hidden Path", "Find the hidden path.", true), globalPct: 1.5 },
];

const SOURCE_TEXT =
  "Climb the scaffolding and take the ladder on the right side to reach the second bell near the old well.";

function makeDossier(): GuideDossier {
  const bells = (src: string) => [
    item("Bell", { collectibleType: "Bell", index: 1, total: 2, location: "Start of the valley", countsForEn: ["Bell Ringer"] }),
    item("Bell", { collectibleType: "Bell", index: 2, total: 2, location: SOURCE_TEXT, countsForEn: ["Bell Ringer"], ...(src === "PowerPyx" ? {} : {}) }),
  ];
  const powerpyx = fact("PowerPyx", "roteiro_psn", {
    chapters: [
      chapter("Weeping Creek", [
        ...bells("PowerPyx"),
        item("Old Lantern", { kind: "key_item", location: "Shrine behind the waterfall", missable: true, missableUntil: "Crimson Forest" }),
      ], 1),
      chapter("Crimson Forest", [item("The Warden", { kind: "boss", location: "Arena", achievementNameEn: "Warden Down" })], 2),
    ],
    achievements: [ach("Bell Ringer"), ach("Warden Down"), ach("The End"), ach("Hidden Path", { howTo: SOURCE_TEXT })],
    roadmap: [
      { title: "Story playthrough", summary: "Play the story and grab every bell." },
      { title: "Cleanup", summary: "Mop up what is left." },
    ],
    hours: { min: 10, max: 12 },
    playthroughs: { min: 1, note: "One run is enough." },
    difficulty: { value: 4, note: "Easy." },
  });
  const steamGuide = fact("SteamGuide", "roteiro_steam", {
    chapters: [chapter("Weeping Creek", bells("SteamGuide"), 1)],
    achievements: [ach("Bell Ringer"), ach("Warden Down"), ach("The End"), ach("Hidden Path")],
    hours: { min: 10, max: 12 },
  });
  return buildDossier(STEAM, [powerpyx, steamGuide], [["PowerPyx"], ["SteamGuide"]]);
}

const GAME: GuideDossierSource = {
  game: {
    slug: "phantom-test",
    name: "Phantom Test",
    steamAppId: 4115450,
    summary: null,
    developer: "S-Game",
    publisher: "S-Game",
    releaseDate: "2026-10-28",
    platforms: ["PC"],
    criticScore: null,
    timeToBeatCompleteMin: null,
    achievementCount: STEAM.length,
  },
  tralked: { players: 0, avgPlaytimeMin: null, completedPlayers: 0 },
  achievements: STEAM,
};

const keysIn = (prompt: string, tag: string) => [...prompt.matchAll(new RegExp(`<${tag} key="([^"]+)"`, "g"))].map((m) => m[1]!);

/** A writer that answers in the shape asked for, echoing the ready-made keys of the prompt (and inventing one). */
function goodFrame(prompt: string, variant = 0) {
  return {
    capa: {
      chamadas: [
        { valor: "1", rotulo: "Perdível" },
        { valor: "0", rotulo: "Online" },
        { valor: "2", rotulo: "Capítulos" },
      ],
      manchete: `O caminho até o Tralked ${variant}`,
      linhaFina: "Todos os sinos e as 4 conquistas, na ordem do jogo.",
    },
    ficha: {
      dificuldade: 4,
      justificativaDificuldade: "Nenhuma conquista pede dificuldade alta.",
      zeradas: "1",
      notaZeradas: "Uma zerada basta.",
      horasMin: 10,
      horasMax: 12,
      maisDificil: "ACH_SECRET",
    },
    visaoGeral: ["Um jogo de ação curto.", "O Tralked sai numa zerada."],
    leiaAntes: [{ titulo: "Lanterna", texto: "Pegue a lanterna antes da floresta.", tom: "aviso", spoiler: false }],
    etapas: keysIn(prompt, "etapa").map((key) => ({ key, titulo: `Etapa ${key}`, horas: "5 h", blocos: [{ tipo: "paragrafo", texto: "Siga a história." }] })),
    capitulos: [
      ...keysIn(prompt, "capitulo").map((key) => ({ key, fase: "inventada", titulo: `Capítulo ${key}`, horas: "3 h", prazo: "Antes da floresta" })),
      { key: "capitulo-inventado", fase: "x", titulo: "Inventado", horas: "1 h", prazo: null },
    ],
  };
}

function goodChapter(prompt: string, variant = 0) {
  return {
    passos: [
      ...keysIn(prompt, "passo").map((key) => ({
        key,
        blocos: [{ tipo: "paragrafo", texto: `Texto próprio do passo ${variant}.` }],
        conquistas: [] as string[],
      })),
      { key: "passo-inventado", blocos: [{ tipo: "paragrafo", texto: "x" }], conquistas: [] },
    ],
    itens: [
      ...keysIn(prompt, "item").map((key) => ({ key, nome: `Nome ${key}`, local: "Perto da entrada.", spoiler: false })),
      { key: "item-inventado", nome: "Inventado", local: "Lugar", spoiler: false },
    ],
    depois: "Dá para voltar depois e pegar o que faltou.",
  };
}

type Verdict = { ok: boolean; problems: string[] };

type Hooks = {
  frame?: (out: ReturnType<typeof goodFrame>) => void;
  chapter?: (out: ReturnType<typeof goodChapter>, prompt: string) => void;
};

function fakeAi(verdicts: Verdict[] = [{ ok: true, problems: [] }], variant = 0, hooks: Hooks = {}) {
  const calls: StructuredOpts<unknown>[] = [];
  let c = 0;
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (opts.purpose.startsWith("guide-write-frame")) {
      const out = goodFrame(opts.user, variant);
      hooks.frame?.(out);
      return out;
    }
    if (opts.purpose.startsWith("guide-write-chapter")) {
      const out = goodChapter(opts.user, variant);
      hooks.chapter?.(out, opts.user);
      return out;
    }
    return verdicts[Math.min(c++, verdicts.length - 1)];
  });
  const ai = { structured, batchRequest: vi.fn(), recordBatchUsage: vi.fn(), assertBudget: vi.fn() } as unknown as Ai;
  return { ai, calls };
}

const allKeys = (p: GuidePayloadV2) => [
  ...p.walkthrough.chapters.map((c) => c.key),
  ...p.walkthrough.chapters.flatMap((c) => c.steps.map((s) => s.key)),
  ...p.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => i.key))),
  ...p.steps.map((s) => s.key ?? ""),
];

describe("guia-estilo.md", () => {
  it("carries the guide rules", () => {
    const style = loadGuideStyle();
    for (const phrase of ["Tralked", "platina", "(inglês)", "namePt", "8 palavras", "spoiler", "antes", "dá para voltar depois", "3 chamadas", "review", "1 a 10"]) {
      expect(style).toContain(phrase);
    }
  });
});

describe("writeGuide", () => {
  it("as chaves vêm do código e se repetem entre duas execuções", async () => {
    const dossier = makeDossier();
    const a = await writeGuide(fakeAi([], 0).ai, dossier, GAME, "live");
    const b = await writeGuide(fakeAi([], 1).ai, dossier, GAME, "live");
    expect(a.walkthrough.cover.headline).not.toBe(b.walkthrough.cover.headline);
    expect(allKeys(a)).toEqual(allKeys(b));
    expect(allKeys(a).join(" ")).not.toMatch(/inventad/);
    // Every chapter points at a roadmap step that exists.
    const phases = new Set(a.steps.map((s) => s.key));
    for (const c of a.walkthrough.chapters) expect(phases.has(c.phaseKey)).toBe(true);
  });

  it("o payload devolvido passa no walkthroughSchema do site", async () => {
    const { ai, calls } = fakeAi();
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const walk = walkthroughSchema.safeParse(payload.walkthrough);
    expect(walk.error?.issues).toBeUndefined();
    const full = guidePayloadSchema.safeParse(payload);
    expect(full.error?.issues).toBeUndefined();
    expect(payload.format).toBe(2);
    expect(payload.status).toBe("review");
    expect(payload.walkthrough.soundtrack).toBeUndefined();
    expect(JSON.stringify(payload.walkthrough)).not.toContain('"image"');

    // The site API's rules (T2): every Steam achievement is an item, refs exist, missables add up.
    const refs = walkAchievementRefs(walk.data!).map((r) => r.apiName);
    for (const r of refs) expect(STEAM.map((s) => s.apiName)).toContain(r);
    const items = walk.data!.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
    for (const s of STEAM) expect(items.some((i) => i.achievement === s.apiName)).toBe(true);
    expect(payload.facts.missables).toBe(items.filter((i) => i.missable && i.kind === "achievement").length);
    expect(new Set(walkItemKeys(walk.data!)).size).toBe(walkItemKeys(walk.data!).length);

    // Hidden achievements and bosses are spoilers; achievement names come from namePt.
    const warden = items.find((i) => i.achievement === "ACH_WARDEN")!;
    expect(warden.spoiler).toBe(true);
    expect(warden.name).toBe("Fim do Guardião");
    expect(warden.nameEn).toBe("Warden Down");
    expect(items.find((i) => i.achievement === "ACH_SECRET")!.spoiler).toBe(true);

    // The missable lantern gets its warning in its own step, before the point of no return.
    const lanternStep = walk.data!.chapters.flatMap((c) => c.steps).find((s) => s.items.some((i) => i.nameEn === "Old Lantern"))!;
    expect(lanternStep.body[0]).toMatchObject({ type: "callout", tone: "aviso" });

    // The model writes with MODEL_WRITER at high effort and never with invented keys.
    const writes = calls.filter((o) => o.purpose.startsWith("guide-write"));
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const w of writes) expect(w).toMatchObject({ model: "claude-opus-5-5", effort: "high", bucket: "live" });
  });

  it("item com uma fonte sai com review true", async () => {
    const payload = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const items = payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items));
    // The lantern and the Warden come from PowerPyx alone; the bells from both sources.
    expect(items.find((i) => i.nameEn === "Old Lantern")!.review).toBe(true);
    expect(items.find((i) => i.achievement === "ACH_WARDEN")!.review).toBe(true);
    const bells = items.filter((i) => i.collectibleType === "Bell");
    expect(bells).toHaveLength(2);
    for (const b of bells) expect(b.review).toBe(false);
  });

  it("um fato com fontes em conflito também sai com review true", async () => {
    const dossier = makeDossier();
    dossier.chapters[0]!.items[0]!.conflict = "total 2 numa fonte e 3 em SteamGuide";
    const payload = await writeGuide(fakeAi().ai, dossier, GAME, "live");
    const first = payload.walkthrough.chapters[0]!.steps[0]!.items[0]!;
    expect(first.collectibleType).toBe("Bell");
    expect(first.review).toBe(true);
  });
});

describe("estrutura feita pelo código", () => {
  const itemsOf = (p: GuidePayloadV2) => p.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => ({ step: s.key, chapter: c.key, i }))));

  it("conquista sem lugar fixo que o modelo põe num passo sai da limpeza", async () => {
    const { ai } = fakeAi([], 0, {
      chapter: (out, prompt) => {
        if (!prompt.includes('<passo key="weeping-creek-2">')) return;
        out.passos.find((p) => p.key === "weeping-creek-2")!.conquistas.push("ACH_BELLS", "NAO_EXISTE");
        out.itens.push({ key: "conq-ach-bells", nome: "x", local: "Toca ao pegar o segundo sino.", spoiler: false });
      },
    });
    const p = await writeGuide(ai, makeDossier(), GAME, "live");
    const bells = itemsOf(p).filter((x) => x.i.achievement === "ACH_BELLS");
    expect(bells).toHaveLength(1);
    expect(bells[0]!.step).toBe("weeping-creek-2");
    expect(bells[0]!.i.key).toBe("conq-ach-bells");
    expect(bells[0]!.i.location).toBe("Toca ao pegar o segundo sino.");
    // Its cleanup step is gone; the other cleanup steps keep their keys.
    const cleanup = p.walkthrough.chapters.find((c) => c.key === "limpeza")!;
    expect(cleanup.steps.map((s) => s.key)).toEqual(["limpeza-2", "limpeza-3"]);
  });

  it("perdível que o modelo não posiciona vai para antes do capítulo do prazo, e vira problema", async () => {
    const dossier = makeDossier();
    const secret = dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!;
    Object.assign(secret, { missable: true, missableUntil: "Crimson Forest", deadlineChapter: "Crimson Forest" });
    const { ai } = fakeAi();
    const { payload, repairs } = await writeGuideDetailed(ai, dossier, GAME, "live");
    const placed = itemsOf(payload).find((x) => x.i.achievement === "ACH_SECRET")!;
    expect(placed.step).toBe("weeping-creek-3");
    expect(placed.i.missable).toBe(true);
    expect(payload.facts.missables).toBe(1);
    expect(repairs.join(" ")).toMatch(/ACH_SECRET/);
  });

  it("o prazo fica no capítulo do perdível, não no capítulo do marco", async () => {
    const p = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const byKey = new Map(p.walkthrough.chapters.map((c) => [c.key, c]));
    expect(byKey.get("weeping-creek")!.deadline).toBe("Antes da floresta");
    expect(byKey.get("crimson-forest")!.deadline).toBeUndefined();
  });

  it("chamada da capa com número fora da ficha é trocada por uma da ficha", async () => {
    const { ai } = fakeAi([], 0, {
      frame: (out) => {
        out.capa.chamadas = [{ valor: "999", rotulo: "Inventado" }, { valor: "10–12 h", rotulo: "Tempo até o Tralked" }];
      },
    });
    const p = await writeGuide(ai, makeDossier(), GAME, "live");
    const calls = p.walkthrough.cover.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ value: "10–12 h", label: "Tempo até o Tralked" });
    expect(calls.map((c) => c.value)).not.toContain("999");
  });
});

describe("writeAndCheckGuide", () => {
  it("reescreve uma vez com os problemas do checador", async () => {
    const { ai, calls } = fakeAi([
      { ok: false, problems: ["O passo diz 3 sinos; o dossiê diz 2."] },
      { ok: true, problems: [] },
    ]);
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(true);
    const checks = calls.filter((o) => o.purpose.startsWith("guide-check"));
    expect(checks).toHaveLength(2);
    for (const c of checks) expect(c).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    const retries = calls.filter((o) => o.purpose.startsWith("guide-write") && o.purpose.endsWith("-retry"));
    expect(retries.length).toBeGreaterThan(0);
    for (const r of retries) expect(r.user).toContain("O passo diz 3 sinos; o dossiê diz 2.");
  });

  it("falha quando a segunda checagem também reprova", async () => {
    const { ai, calls } = fakeAi([{ ok: false, problems: ["Número errado."] }]);
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain("Número errado.");
    expect(calls.filter((o) => o.purpose.startsWith("guide-check"))).toHaveLength(2);
  });

  it("a cópia de uma fonte vira problema antes do checador", async () => {
    const dossier = makeDossier();
    const { ai, calls } = fakeAi();
    // The writer copies the source's sentence into every item location.
    const structured = ai.structured as unknown as ReturnType<typeof vi.fn>;
    const original = structured.getMockImplementation() as (o: StructuredOpts<unknown>) => Promise<unknown>;
    let copied = false;
    structured.mockImplementation(async (opts: StructuredOpts<unknown>) => {
      const out = await original(opts);
      if (opts.purpose === "guide-write-chapter" && !copied) {
        copied = true;
        (out as { itens: { local: string }[] }).itens.forEach((i) => (i.local = SOURCE_TEXT));
      }
      return out;
    });
    const result = await writeAndCheckGuide(ai, dossier, GAME, "live");
    expect(result.ok).toBe(true);
    const retries = calls.filter((o) => o.purpose.endsWith("-retry"));
    expect(retries.length).toBeGreaterThan(0);
    expect(retries[0]!.user).toMatch(/copiad/i);
  });
});

describe("copiedRuns", () => {
  const source = "Climb the scaffolding and take the ladder on the right side to reach the second bell.";

  it("verificador de cópia: frase de 9 palavras igual à fonte → problema", () => {
    const text = "Depois disso, take the ladder on the right side to reach the second bell e siga.";
    const runs = copiedRuns(text, [source], 9);
    expect(runs).toEqual(["take the ladder on the right side to reach the second bell"]);
  });

  it("8 palavras seguidas iguais ainda passam", () => {
    // 8 words in a row equal to the source ("take ... to"), then the text goes its own way.
    const text = "Então take the ladder on the right side to chegar, com calma.";
    expect(copiedRuns(text, [source], 9)).toEqual([]);
  });

  it("ignora acento, caixa e pontuação", () => {
    const runs = copiedRuns("Suba no ANDAIME, pegue a escada à direita e chegue ao segundo sino agora", ["suba no andaime pegue a escada a direita e chegue ao segundo sino"], 9);
    expect(runs).toHaveLength(1);
  });
});

describe("checkGuide", () => {
  it("usa MODEL_FAST com esforço baixo e devolve os problemas", async () => {
    const { ai, calls } = fakeAi([{ ok: false, problems: [" A ficha diz 2 perdíveis. ", ""] }]);
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const verdict = await checkGuide(ai, payload, makeDossier());
    expect(verdict).toEqual({ ok: false, problems: ["A ficha diz 2 perdíveis."] });
    const check = calls.find((o) => o.purpose === "guide-check")!;
    expect(check).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    expect(check.user).toContain("<dossie>");
    expect(check.user).toContain("<guia>");
  });

  it("reprovação sem problema listado ainda é reprovação", async () => {
    const { ai } = fakeAi([{ ok: false, problems: [] }]);
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const verdict = await checkGuide(ai, payload, makeDossier());
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toHaveLength(1);
  });
});
