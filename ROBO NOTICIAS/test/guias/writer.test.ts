import { describe, expect, it } from "vitest";
import { guidePayloadSchema } from "@/lib/content/guide-schema";
import { walkAchievementRefs, walkItemKeys, walkthroughSchema } from "@/lib/content/walkthrough-schema";
import { MAX_NONSTREAMING_TOKENS } from "../../src/ai/client.js";
import { checkGuide } from "../../src/guias/checker.js";
import { chronologyProblems } from "../../src/guias/chronology.js";
import type { GuidePayloadV2 } from "../../src/guias/contract.js";
import { buildDossier, type DossierChapter, type GuideDossier, type GuideDossierSource, type SteamAchievement } from "../../src/guias/dossier.js";
import { inPool } from "../../src/guias/pool.js";
import { psnScope } from "../../src/guias/scope.js";
import { buildSkeleton } from "../../src/guias/skeleton.js";
import { knownNames } from "../../src/guias/copy-check.js";
import { copiedRuns, loadGuideStyle, parseSavedTexts, writeAndCheckGuide, writeGuide, writeGuideDetailed, type DraftRound } from "../../src/guias/writer.js";
import { ach, chapter, fact, item, steamAch } from "./helpers-dossier.js";
import { fakeAi, keysIn, OK } from "./helpers-writer.js";

const STEAM: SteamAchievement[] = [
  { ...steamAch("ACH_BELLS", "Bell Ringer", "Ring 2 bells."), namePt: "Sineiro", descriptionPt: "Toque 2 sinos." },
  { ...steamAch("ACH_WARDEN", "Warden Down", "Defeat the Warden.", true), namePt: "Fim do Guardião", globalPct: 3 },
  { ...steamAch("ACH_ENDING", "The End", "Finish the story."), globalPct: 40 },
  { ...steamAch("ACH_SECRET", "Hidden Path", "Find the hidden path.", true), globalPct: 1.5 },
];

const SOURCE_TEXT =
  "Climb the scaffolding and take the ladder on the right side to reach the second bell near the old well.";

/** Three chapters (Weeping Creek, Crimson Forest, Ashen Peak) from two sources, plus 3 loose achievements. */
function makeDossier(): GuideDossier {
  const bells = () => [
    item("Bell", { collectibleType: "Bell", index: 1, total: 2, location: "Start of the valley", countsForEn: ["Bell Ringer"] }),
    item("Bell", { collectibleType: "Bell", index: 2, total: 2, location: SOURCE_TEXT, countsForEn: ["Bell Ringer"] }),
  ];
  const powerpyx = fact("PowerPyx", "roteiro_psn", {
    chapters: [
      chapter("Weeping Creek", [
        ...bells(),
        item("Old Lantern", { kind: "key_item", location: "Shrine behind the waterfall", missable: true, missableUntil: "Crimson Forest" }),
      ], 1),
      chapter("Crimson Forest", [item("The Warden", { kind: "boss", location: "Arena", achievementNameEn: "Warden Down" })], 2),
      chapter("Ashen Peak", [item("Ash Feather", { location: "Summit" })], 3),
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
    chapters: [chapter("Weeping Creek", bells(), 1)],
    achievements: [ach("Bell Ringer"), ach("Warden Down"), ach("The End"), ach("Hidden Path")],
    hours: { min: 10, max: 12 },
  });
  return buildDossier(STEAM, [powerpyx, steamGuide], [["PowerPyx"], ["SteamGuide"]]);
}

/** makeDossier with ACH_ENDING's how-to replaced (Task 23: targets it cites are known names). */
function makeDossierWith(howTo: string): GuideDossier {
  const dossier = makeDossier();
  dossier.achievements.find((a) => a.apiName === "ACH_ENDING")!.howTo = howTo;
  return dossier;
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

const allKeys = (p: GuidePayloadV2) => [
  ...p.walkthrough.chapters.map((c) => c.key),
  ...p.walkthrough.chapters.flatMap((c) => c.steps.map((s) => s.key)),
  ...p.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => i.key))),
  ...p.steps.map((s) => s.key ?? ""),
];
const itemsOf = (p: GuidePayloadV2) =>
  p.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.map((i) => ({ step: s.key, chapter: c.key, i }))));

describe("guia-estilo.md", () => {
  it("carries the guide rules", () => {
    const style = loadGuideStyle();
    for (const phrase of ["Tralked", "platina", "(inglês)", "namePt", "8 palavras", "spoiler", "antes", "dá para voltar depois", "3 chamadas", "review", "1 a 10", "calculados pelo sistema", "||…||", "||spoiler||"]) {
      expect(style).toContain(phrase);
    }
  });
});

describe("writeGuide", () => {
  it("as chaves vêm do código e se repetem entre duas execuções", async () => {
    const dossier = makeDossier();
    const a = await writeGuide(fakeAi({ variant: 0 }).ai, dossier, GAME, "live");
    const b = await writeGuide(fakeAi({ variant: 1 }).ai, dossier, GAME, "live");
    expect(a.walkthrough.cover.headline).not.toBe(b.walkthrough.cover.headline);
    expect(allKeys(a)).toEqual(allKeys(b));
    expect(allKeys(a).join(" ")).not.toMatch(/inventad/);
    // Every chapter points at a roadmap step that exists.
    const phases = new Set(a.steps.map((s) => s.key));
    for (const c of a.walkthrough.chapters) expect(phases.has(c.phaseKey)).toBe(true);
  });

  it("o payload devolvido passa no walkthroughSchema do site", async () => {
    const { ai, of } = fakeAi();
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

    // The model writes with MODEL_WRITER at high effort.
    const writes = of("guide-write");
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const w of writes) expect(w).toMatchObject({ model: "claude-opus-5-5", effort: "high", bucket: "live" });
  });

  it("spoiler ||…|| no texto passa no schema do site; || sem par cai e nomes saem sem ||", async () => {
    const { ai } = fakeAi({
      chapter: (out, _prompt, n) => {
        if (n > 0) return;
        const step = out.passos[0]! as { blocos: { tipo: string; texto: string }[] };
        step.blocos = [
          { tipo: "paragrafo", texto: "Ali você enfrenta ||**o Guardião**||." },
          { tipo: "aviso", texto: "Corte no meio ||sem fechar" },
        ];
        const item = out.itens[0]!;
        item.local = "Atrás do trono de ||Hua||.";
        item.nome = "Nome ||com marcador||";
      },
    });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    expect(walkthroughSchema.safeParse(payload.walkthrough).error?.issues).toBeUndefined();
    const texts = JSON.stringify(payload.walkthrough);
    expect(texts).toContain("Ali você enfrenta ||**o Guardião**||.");
    expect(texts).toContain("Corte no meio sem fechar");
    expect(texts).toContain("Atrás do trono de ||Hua||.");
    expect(texts).toContain("Nome com marcador");
    expect(texts).not.toContain("Nome ||");
  });

  it("R19: roadmap e prazo guardam ||…|| para o site esconder; campos à vista só perdem as marcas", async () => {
    const { ai } = fakeAi({
      frame: (out) => {
        out.etapas = out.etapas.map((e) => ({
          ...e,
          titulo: `Até ||o Guardião||`,
          blocos: [{ tipo: "paragrafo" as const, texto: "Siga até ||**o Guardião**|| e volte." }],
        }));
        out.capitulos = out.capitulos.map((c) => ({ ...c, titulo: `${c.titulo} ||Guardião||`, prazo: "Antes de ||o Guardião||" }));
        out.visaoGeral = ["Um jogo curto com ||o Guardião|| no fim."];
      },
    });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    expect(guidePayloadSchema.safeParse(payload).error?.issues).toBeUndefined();

    // The roadmap and the deadline keep the span: the walkthrough page masks it there.
    for (const step of payload.steps) {
      expect(step.title).toBe("Até ||o Guardião||");
      expect(step.body).toEqual([{ type: "paragraph", text: "Siga até ||**o Guardião**|| e volte." }]);
    }
    const withDeadline = payload.walkthrough.chapters.filter((c) => c.deadline);
    expect(withDeadline.length).toBeGreaterThan(0);
    for (const c of withDeadline) expect(c.deadline).toBe("Antes de ||o Guardião||");

    // Fields shown as is lose the markers only (the name stays: search finds it, the manual keeps it out).
    for (const c of payload.walkthrough.chapters) {
      expect(c.title).not.toContain("||");
      if (c.title.startsWith("Capítulo")) expect(c.title).toMatch(/ Guardião$/);
    }
    expect(payload.overview).toEqual(["Um jogo curto com o Guardião no fim."]);
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

  it("perdível com o prazo assumido (o próprio capítulo) sai com review true e o aviso de pegar agora", async () => {
    const dossier = makeDossier();
    // A bell is listed by both sources (no review on its own); here no source says until when it can be lost.
    Object.assign(dossier.chapters[0]!.items[0]!, { missable: true, deadlineChapter: dossier.chapters[0]!.title, deadlineAssumed: true });
    const payload = await writeGuide(fakeAi().ai, dossier, GAME, "live");
    const step = payload.walkthrough.chapters[0]!.steps[0]!;
    const first = step.items[0]!;
    expect(first.collectibleType).toBe("Bell");
    expect(first.review).toBe(true);
    expect(step.body.some((b) => b.type === "callout" && b.tone === "aviso" && /pegue .* agora/.test(b.text))).toBe(true);
  });

  it("item com número dado pelo código (R28) sai com review true", async () => {
    const dossier = makeDossier();
    Object.assign(dossier.chapters[0]!.items[0]!, { numberAssumed: true });
    const payload = await writeGuide(fakeAi().ai, dossier, GAME, "live");
    expect(payload.walkthrough.chapters[0]!.steps[0]!.items[0]!.review).toBe(true);
  });

  it("item ligado a um 'collect N' pelo tipo: exato não pede revisão, ambíguo (pétalas de tamanho variável) pede", async () => {
    const exact = makeDossier();
    Object.assign(exact.chapters[0]!.items[0]!, { countedByType: "exact" });
    expect((await writeGuide(fakeAi().ai, exact, GAME, "live")).walkthrough.chapters[0]!.steps[0]!.items[0]!.review).toBe(false);
    const ambiguous = makeDossier();
    Object.assign(ambiguous.chapters[0]!.items[0]!, { countedByType: "ambiguous" });
    expect((await writeGuide(fakeAi().ai, ambiguous, GAME, "live")).walkthrough.chapters[0]!.steps[0]!.items[0]!.review).toBe(true);
  });

  it("item de revisita que o código pôs no fim (sem posição declarada pela fonte) sai com review true", async () => {
    const dossier = makeDossier();
    // A bell listed by both sources: no review on its own.
    Object.assign(dossier.chapters[0]!.items[0]!, { orderAssumed: true });
    const payload = await writeGuide(fakeAi().ai, dossier, GAME, "live");
    const first = payload.walkthrough.chapters[0]!.steps[0]!.items[0]!;
    expect(first.collectibleType).toBe("Bell");
    expect(first.review).toBe(true);
  });
});

describe("números só do dossiê, do catálogo ou do código", () => {
  it("sem horas nas fontes nem no catálogo: zero na ficha, — no selo, nos capítulos e nas etapas, sem reparo", async () => {
    const dossier = makeDossier();
    dossier.facts.hours = undefined;
    const { payload, repairs } = await writeGuideDetailed(fakeAi().ai, dossier, GAME, "live");
    expect(payload.facts).toMatchObject({ hoursMin: 0, hoursMax: 0, playthroughs: "1" });
    expect(payload.walkthrough.cover.sealHours).toBe("—");
    for (const c of payload.walkthrough.chapters) expect(c.hours).toBe("—");
    for (const s of payload.steps) expect(s.hours).toBe("—");
    expect(repairs).toEqual([]);
  });

  it("horas vêm do tempo do catálogo quando as fontes não têm; zeradas sem dado viram —", async () => {
    const dossier = makeDossier();
    dossier.facts.hours = undefined;
    dossier.facts.playthroughs = undefined;
    const game = { ...GAME, game: { ...GAME.game, timeToBeatCompleteMin: 615 } };
    const payload = await writeGuide(fakeAi().ai, dossier, game, "live");
    expect(payload.facts).toMatchObject({ hoursMin: 10, hoursMax: 10, playthroughs: "—" });
    expect(payload.walkthrough.cover.sealHours).toBe("10 h");
  });

  it("chamada da capa com número fora da ficha é trocada por uma da ficha", async () => {
    const { ai } = fakeAi({
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

describe("estrutura feita pelo código", () => {
  it("conquista sem lugar fixo que o modelo põe num passo sai da limpeza", async () => {
    const { ai } = fakeAi({
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

  const missableSecret = () => {
    const dossier = makeDossier();
    const secret = dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!;
    Object.assign(secret, { missable: true, missableUntil: "Crimson Forest", deadlineChapter: "Crimson Forest" });
    return dossier;
  };

  it("perdível que o modelo não posiciona vai para antes do capítulo do prazo, e fica registrado como nota", async () => {
    const { payload, repairs } = await writeGuideDetailed(fakeAi().ai, missableSecret(), GAME, "live");
    const placed = itemsOf(payload).find((x) => x.i.achievement === "ACH_SECRET")!;
    expect(placed.step).toBe("weeping-creek-3");
    expect(placed.i.missable).toBe(true);
    expect(payload.facts.missables).toBe(1);
    expect(repairs.find((r) => r.text.includes("ACH_SECRET"))?.kind).toBe("nota");
  });

  it("perdível posto pelo modelo depois do capítulo do prazo é recusado e vai para antes dele", async () => {
    const { ai, of } = fakeAi({
      chapter: (out, prompt) => {
        if (!prompt.includes('<passo key="ashen-peak-1">')) return;
        out.passos.find((p) => p.key === "ashen-peak-1")!.conquistas.push("ACH_SECRET");
      },
    });
    const { payload, repairs } = await writeGuideDetailed(ai, missableSecret(), GAME, "live");
    expect(itemsOf(payload).find((x) => x.i.achievement === "ACH_SECRET")!.step).toBe("weeping-creek-3");
    const refused = repairs.find((r) => r.text.includes("depois do capítulo"))!;
    expect(refused).toMatchObject({ scope: "ashen-peak-1" });
    // The Ashen Peak call was not even offered the missable (its milestone chapter came before).
    const ashen = of("guide-write-chapter").find((c) => c.user.includes('<passo key="ashen-peak-1">'))!;
    expect(ashen.user).not.toContain('apiName="ACH_SECRET"');
    expect(ashen.user).toContain('apiName="ACH_ENDING"');
  });

  it("um passo nunca passa de 40 itens, nem com muitas conquistas postas nele nem com o perdível de reserva", async () => {
    const dossier = missableSecret();
    const ending = dossier.achievements.find((a) => a.apiName === "ACH_ENDING")!;
    const extra = Array.from({ length: 45 }, (_, n) => ({ ...ending, apiName: `ACH_X${n + 1}`, nameEn: `Extra ${n + 1}` }));
    dossier.achievements.push(...extra);
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (!prompt.includes('<passo key="weeping-creek-3">')) return;
        // 45 placements in a step that already holds the lantern.
        out.passos.find((p) => p.key === "weeping-creek-3")!.conquistas.push(...extra.map((a) => a.apiName));
      },
    });
    const { payload, repairs } = await writeGuideDetailed(ai, dossier, GAME, "live");
    const steps = new Map(payload.walkthrough.chapters.flatMap((c) => c.steps.map((s) => [s.key, s] as const)));
    for (const s of steps.values()) expect(s.items.length).toBeLessThanOrEqual(40);
    expect(steps.get("weeping-creek-3")!.items).toHaveLength(40);
    // The 6 that did not fit stay in cleanup, with a problem for the job that placed them.
    const inCleanup = itemsOf(payload).filter((x) => x.chapter === "limpeza" && x.i.achievement?.startsWith("ACH_X"));
    expect(inCleanup).toHaveLength(6);
    expect(repairs.filter((r) => r.text.includes("não coube") && r.scope === "weeping-creek-1")).toHaveLength(6);
    // The missable's fallback step (end of Weeping Creek) is full: it goes to the nearest earlier step with room.
    expect(itemsOf(payload).find((x) => x.i.achievement === "ACH_SECRET")!.step).toBe("weeping-creek-2");
    // Every Steam achievement is still in the guide, and the site accepts it.
    for (const a of dossier.achievements) expect(itemsOf(payload).some((x) => x.i.achievement === a.apiName)).toBe(true);
    expect(walkthroughSchema.safeParse(payload.walkthrough).error?.issues).toBeUndefined();
  });

  it("o prazo fica no capítulo do perdível, não no capítulo do marco", async () => {
    const p = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const byKey = new Map(p.walkthrough.chapters.map((c) => [c.key, c]));
    expect(byKey.get("weeping-creek")!.deadline).toBe("Antes da floresta");
    expect(byKey.get("crimson-forest")!.deadline).toBeUndefined();
  });

  it("as conquistas sem lugar fixo vão compactas (sem o como) aos capítulos", async () => {
    const { ai, of } = fakeAi();
    await writeGuide(ai, makeDossier(), GAME, "live");
    const weeping = of("guide-write-chapter").find((c) => c.user.includes('<passo key="weeping-creek-1">'))!;
    expect(weeping.user).toContain('<conquista key="conq-ach-secret" apiName="ACH_SECRET"');
    expect(weeping.user).not.toContain(SOURCE_TEXT.slice(0, 40) + " near"); // the howTo of ACH_SECRET
    expect(weeping.user.split("## Conquistas sem lugar fixo")[1]).not.toContain("Climb the scaffolding");
  });
});

describe("gasto", () => {
  it("o primeiro erro de uma chamada para o pool: nenhuma chamada nova depois dele", async () => {
    const dossier = makeDossier();
    const extra: DossierChapter[] = Array.from({ length: 8 }, (_, n) => ({
      title: `Extra ${n + 1}`,
      order: 10 + n,
      items: [{ ...dossier.chapters[2]!.items[0]!, id: `x${n}`, name: `Extra item ${n + 1}`, nameEn: `Extra item ${n + 1}` }],
    }));
    dossier.chapters.push(...extra);
    const { ai, of } = fakeAi({
      chapter: async (_out, _prompt, n) => {
        if (n === 0) throw new Error("API caiu");
        await new Promise((r) => setTimeout(r, 20));
      },
    });
    await expect(writeGuide(ai, dossier, GAME, "live")).rejects.toThrow("API caiu");
    await new Promise((r) => setTimeout(r, 100));
    // 12 jobs exist; only the 3 started together were paid for.
    expect(of("guide-write-chapter").length).toBeLessThanOrEqual(3);
  });

  it("inPool para de puxar trabalho quando uma chamada falha", async () => {
    const started: number[] = [];
    const run = async (n: number) => {
      started.push(n);
      if (n === 1) throw new Error("falhou");
      await new Promise((r) => setTimeout(r, 10));
      return n;
    };
    await expect(inPool([1, 2, 3, 4, 5, 6], 2, run)).rejects.toThrow("falhou");
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toEqual([1, 2]);
  });
});

describe("writeAndCheckGuide", () => {
  it("reescreve uma vez com os problemas do checador", async () => {
    const problem = "O passo crimson-forest-1 diz 3 chefes; o dossiê diz 1.";
    let failed = false;
    const { ai, of } = fakeAi({
      verdict: (user) => {
        if (!failed && user.includes('"key":"crimson-forest-1"')) {
          failed = true;
          return { ok: false, problems: [problem] };
        }
        return OK;
      },
    });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(true);
    for (const c of of("guide-check")) expect(c).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
    // Only the job the problem points at is rewritten (no frame, no other chapter), with its problem.
    const retries = of("guide-write").filter((o) => o.purpose.endsWith("-retry"));
    expect(retries).toHaveLength(1);
    expect(retries[0]!.purpose).toBe("guide-write-chapter-retry");
    expect(retries[0]!.user).toContain('<passo key="crimson-forest-1">');
    expect(retries[0]!.user).toContain(problem);
    // First round: frame + 4 jobs; second round: only the rewritten job.
    expect(of("guide-check")).toHaveLength(6);
  });

  it("um problema da moldura reescreve só a moldura", async () => {
    let failed = false;
    const { ai, of } = fakeAi({
      verdict: (user) => {
        if (!failed && user.includes('"leiaAntes"')) {
          failed = true;
          return { ok: false, problems: ["A visão geral cita um chefe."] };
        }
        return OK;
      },
    });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(true);
    const retries = of("guide-write").filter((o) => o.purpose.endsWith("-retry"));
    expect(retries.map((r) => r.purpose)).toEqual(["guide-write-frame-retry"]);
  });

  it("falha quando a segunda checagem também reprova", async () => {
    const { ai } = fakeAi({ verdict: () => ({ ok: false, problems: ["Número errado."] }) });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toContain("Número errado.");
  });

  it("a cópia de uma fonte vira problema antes do checador e reescreve só aquele trecho", async () => {
    const { ai, of } = fakeAi({
      chapter: (out, prompt) => {
        // The first Weeping Creek answer copies the source's sentence into every item location.
        if (prompt.includes('<passo key="weeping-creek-1">') && !prompt.includes("Correções obrigatórias")) {
          out.itens.forEach((i) => (i.local = SOURCE_TEXT));
        }
      },
    });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(true);
    const retries = of("guide-write").filter((o) => o.purpose.endsWith("-retry"));
    expect(retries).toHaveLength(1);
    expect(retries[0]!.user).toContain('<passo key="weeping-creek-1">');
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

  describe("Task 23: nomes próprios conhecidos do dossiê não contam como cópia", () => {
    // The real false positives of the PBZ run (the source lines and the dossier's names, as they are).
    const pbzSource = "Memory Flower – Xuan Li’s Memory Flower – 6. Control: after the cutscene, defeat Meng Hua, the Merciful Lady of the Blossom Veil, the normal final boss.";
    const pbzNames = ["Memory Flower – Xuan Li’s Memory Flower – 6. Control", "Boss: Meng Hua, the Merciful Lady of the Blossom Veil"];

    it("os dois casos reais da rodada completa não são cópia", () => {
      expect(copiedRuns("Pegue a Memory Flower – Xuan Li's Memory Flower – 6. Control logo ali.", [pbzSource], 9)).toEqual([
        "memory flower xuan li s memory flower 6 control",
      ]);
      expect(copiedRuns("Pegue a Memory Flower – Xuan Li's Memory Flower – 6. Control logo ali.", [pbzSource], 9, pbzNames)).toEqual([]);
      expect(copiedRuns("A luta é contra ||Meng Hua, the Merciful Lady of the Blossom Veil||, no fim.", [pbzSource], 9, pbzNames)).toEqual([]);
    });

    it("um alvo citado no dossiê (\"defeat X\") também é nome conhecido", () => {
      const names = knownNames(makeDossierWith("Defeat Meng Hua, the Merciful Lady of the Blossom Veil, the normal final boss."));
      expect(copiedRuns("Vença Meng Hua, the Merciful Lady of the Blossom Veil para fechar.", [pbzSource], 9, names)).toEqual([]);
    });

    it("uma frase descritiva copiada continua contando, com ou sem nome no meio", () => {
      const names = ["Second Bell", "Old Well"];
      expect(copiedRuns("Depois disso, take the ladder on the right side to reach the second bell e siga.", [source], 9, names)).toEqual([
        "take the ladder on the right side to reach the second bell",
      ]);
      // A name inside a copied run removes only its own words: 9 other equal words in a row still count.
      const long = "Climb the scaffolding and take the ladder on the right side, then pass the Old Well and keep going up the stairs.";
      expect(copiedRuns("Climb the scaffolding and take the ladder on the right side, then pass the Old Well e suba.", [long], 9, names)).toHaveLength(1);
      // A one-word name never hides anything ("the" is no name).
      expect(copiedRuns("Depois disso, take the ladder on the right side to reach the second bell e siga.", [source], 9, ["the", "Ladder"])).toHaveLength(1);
    });

    it("revisão: um nome no meio de uma frase copiada (8 palavras + nome + 8 palavras) não a salva", () => {
      const copied = "Walk past the broken cart and climb the Old Well then cross the wooden bridge and follow it.";
      expect(copiedRuns(`Dica: ${copied}`, [copied], 9, ["Old Well"])).toEqual([
        "walk past the broken cart and climb the old well then cross the wooden bridge and follow it",
      ]);
    });

    it("revisão: a cauda de uma instrução em minúscula depois de \"defeat\" não vira nome", () => {
      const names = knownNames(makeDossierWith("Defeat the Warden and take the ladder on the right side to reach the second bell."));
      expect(names.some((n) => /ladder/i.test(n))).toBe(false);
      expect(copiedRuns("Depois disso, take the ladder on the right side to reach the second bell e siga.", [source], 9, names)).toHaveLength(1);
      // A long target (more than 6 words) is no name either.
      const long = knownNames(makeDossierWith("Defeat Lord Of The Very Long Winding Mountain Pass Title."));
      expect(long.some((n) => /winding/i.test(n))).toBe(false);
    });

    it("revisão: o tipo de coletável é substantivo genérico, não nome", () => {
      const dossier = makeDossier();
      dossier.chapters[0]!.items[0]!.collectibleType = "Memory Flower";
      expect(knownNames(dossier)).not.toContain("Memory Flower");
    });

    it("revisão: a parte de um nome que começa com artigo ou em minúscula não vale sozinha", () => {
      const source2 = "At the summit the Merciful Lady of the Blossom Veil waits at the top of the stairs.";
      const text = "No alto, the Merciful Lady of the Blossom Veil waits at the top, pronta.";
      expect(copiedRuns(text, [source2], 9, ["Boss: Meng Hua, the Merciful Lady of the Blossom Veil"])).toHaveLength(1);
      expect(copiedRuns(text, [source2], 9, ["Shrine: the merciful lady of the blossom veil"])).toHaveLength(1);
    });
  });
});

describe("checkGuide", () => {
  it("usa o modelo do checador (Sonnet, esforço alto, sem stream) por padrão, uma chamada por trecho, e devolve os problemas sem repetir", async () => {
    const { ai, of } = fakeAi({ verdict: () => ({ ok: false, problems: [" A ficha diz 2 perdíveis. ", ""] }) });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const verdict = await checkGuide(ai, payload, makeDossier());
    // Task 21 review: an empty defect is still a defect (the fallback sentence), never dropped.
    expect(verdict).toEqual({ ok: false, problems: ["A ficha diz 2 perdíveis.", "O checador reprovou este trecho do guia sem apontar o problema."] });
    const checks = of("guide-check");
    expect(checks).toHaveLength(5); // frame + Weeping Creek + Crimson Forest + Ashen Peak + cleanup
    for (const c of checks) {
      // Task 22: Sonnet with high effort; room for its thinking, under the non-streaming limit.
      expect(c).toMatchObject({ model: "claude-sonnet-5-5", effort: "high", maxTokens: 16000 });
      expect(c.maxTokens!).toBeLessThanOrEqual(MAX_NONSTREAMING_TOKENS);
      expect(c.user).toContain("<numeros_do_codigo>");
      expect(c.user).toContain("<dossie>");
      expect(c.user).toContain("<guia>");
    }
    // A job check carries only its own steps and the dossier facts behind them.
    const crimson = checks.find((c) => c.user.includes('"key":"crimson-forest-1"'))!;
    expect(crimson.user).not.toContain('"key":"weeping-creek-1"');
    expect(crimson.user).toContain("Warden Down");
    expect(crimson.user).not.toContain("Old Lantern");
  });

  it("os números do código vão ao checador como autoritativos, inclusive horas do catálogo", async () => {
    const dossier = makeDossier();
    dossier.facts.hours = undefined;
    const game = { ...GAME, game: { ...GAME.game, timeToBeatCompleteMin: 615 } };
    const { ai, of } = fakeAi();
    const payload = await writeGuide(ai, dossier, game, "live");
    await checkGuide(ai, payload, dossier);
    const frameCheck = of("guide-check").find((c) => c.user.includes('"leiaAntes"'))!;
    const numbers = frameCheck.user.split("</numeros_do_codigo>")[0]!;
    expect(numbers).toContain('"hoursMin":10');
    expect(numbers).toContain('"seloHoras":"10 h"');
    expect(frameCheck.system).toMatch(/certos por definição/);
  });

  it("Task 21: de uma lista mista, só os defeitos ficam; uma lista só de acertos aprova", async () => {
    const { ai, of } = fakeAi({
      verdict: (user) =>
        user.includes('"leiaAntes"')
          ? {
              problems: [
                { tipo: "defeito", texto: "A capa diz 3 perdíveis; a ficha diz 1." },
                { tipo: "correto", texto: "A conquista sem nome PT-BR usa o nome em inglês, o que é aceitável." },
              ],
            }
          : { problems: [{ tipo: "correto", texto: "O prazo do passo é consistente com o dossiê." }] },
    });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const verdict = await checkGuide(ai, payload, makeDossier());
    expect(verdict).toEqual({ ok: false, problems: ["A capa diz 3 perdíveis; a ficha diz 1."] });
    const check = of("guide-check")[0]!;
    expect(check.system).toContain("liste só defeitos; não liste o que está correto");
    expect(check.system).toContain("use 'correto' só para o que está certo; prefira não listar");
  });

  it("Task 21 revisão: um defeito sem descrição ainda reprova, com a frase de reserva", async () => {
    const { ai } = fakeAi({ verdict: () => ({ problems: [{ tipo: "defeito", texto: "   " }, { tipo: "correto", texto: "" }] }) });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const verdict = await checkGuide(ai, payload, makeDossier());
    expect(verdict).toEqual({ ok: false, problems: ["O checador reprovou este trecho do guia sem apontar o problema."] });
  });
});

describe("ordem cronológica (checagem do código)", () => {
  const check = (payload: GuidePayloadV2, dossier = makeDossier()) => chronologyProblems(payload, buildSkeleton(dossier), dossier);

  it("o guia sai na ordem do roteiro principal e passa", async () => {
    const dossier = makeDossier();
    expect(dossier.primaryScript?.chapters).toEqual(["Weeping Creek", "Crimson Forest", "Ashen Peak"]);
    const payload = await writeGuide(fakeAi().ai, dossier, GAME, "live");
    expect(check(payload, dossier)).toEqual([]);
  });

  it("um capítulo fora da ordem da fonte principal é pego", async () => {
    const payload = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const [first, second, ...rest] = payload.walkthrough.chapters;
    payload.walkthrough.chapters = [second!, first!, ...rest];
    expect(check(payload)).toContainEqual({
      key: null,
      owner: "code",
      text: 'O capítulo weeping-creek veio depois de crimson-forest, mas no roteiro principal (PowerPyx) "Weeping Creek" vem antes de "Crimson Forest". Siga a ordem da fonte.',
    });
  });

  it("um perdível depois do capítulo em que se perde é pego", async () => {
    const payload = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const [weeping, , ashen] = payload.walkthrough.chapters;
    const from = weeping!.steps.find((s) => s.items.some((i) => i.nameEn === "Old Lantern"))!;
    const lantern = from.items.find((i) => i.nameEn === "Old Lantern")!;
    from.items = from.items.filter((i) => i !== lantern);
    ashen!.steps[0]!.items.push(lantern);
    const problems = check(payload);
    expect(problems).toContainEqual({
      key: lantern.key,
      owner: "code",
      text: `O perdível "${lantern.name}" (${lantern.key}) está no capítulo ashen-peak, depois de crimson-forest, onde ele se perde. O aviso tem que vir antes do ponto de não retorno.`,
    });
  });

  it("um passo com perdível sem o aviso é pego", async () => {
    const payload = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const step = payload.walkthrough.chapters[0]!.steps.find((s) => s.items.some((i) => i.missable))!;
    step.body = step.body.filter((b) => !(b.type === "callout" && b.tone === "aviso"));
    expect(check(payload)).toEqual([{ key: step.key, owner: "code", text: `O passo ${step.key} tem perdível e não traz o aviso de perdível.` }]);
  });

  it("um capítulo numa etapa anterior à do capítulo de antes é pego; o escritor já corrige a fase", async () => {
    const payload = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const [story, cleanup] = payload.steps.map((s) => s.key!);
    payload.walkthrough.chapters[0]!.phaseKey = cleanup!;
    payload.walkthrough.chapters[1]!.phaseKey = story!;
    expect(check(payload)).toContainEqual({
      key: null,
      owner: "code",
      text: `O capítulo crimson-forest está na etapa ${story}, que vem antes da etapa ${cleanup} do capítulo anterior. As etapas seguem o roadmap, na ordem.`,
    });

    // The writer never lets the model send a chapter back to an earlier phase.
    const { ai } = fakeAi({
      frame: (out) => {
        out.capitulos = out.capitulos.map((c, i) => ({ ...c, fase: i === 0 ? cleanup! : story! }));
      },
    });
    const written = await writeGuideDetailed(ai, makeDossier(), GAME, "live");
    expect(written.payload.walkthrough.chapters.map((c) => c.phaseKey)).toEqual([cleanup, cleanup, cleanup, cleanup]);
    expect(written.repairs.map((r) => r.text)).toContain(
      `O capítulo crimson-forest foi posto na etapa ${story}, antes da etapa ${cleanup} do capítulo anterior; ficou na ${cleanup}. As etapas seguem o roadmap, na ordem.`,
    );
  });
});

describe("ordem cronológica: de quem é o erro", () => {
  it("conquista sem lugar fixo posta pelo modelo depois do prazo é problema do escritor", async () => {
    const dossier = makeDossier();
    const secret = dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!;
    Object.assign(secret, { missable: true, deadlineChapter: "Crimson Forest" });
    const payload = await writeGuide(fakeAi().ai, dossier, GAME, "live");
    const at = payload.walkthrough.chapters.flatMap((c) => c.steps).find((s) => s.items.some((i) => i.achievement === "ACH_SECRET"))!;
    const placed = at.items.find((i) => i.achievement === "ACH_SECRET")!;
    at.items = at.items.filter((i) => i !== placed);
    payload.walkthrough.chapters[2]!.steps[0]!.items.push(placed);
    expect(chronologyProblems(payload, buildSkeleton(dossier), dossier)).toContainEqual(
      expect.objectContaining({ key: placed.key, owner: "writer" }),
    );
  });

  it("ordem que o próprio código fez errada vira erro interno no resultado, sem reescrita do modelo", async () => {
    const dossier = makeDossier();
    dossier.primaryScript = { ...dossier.primaryScript!, chapters: [...dossier.primaryScript!.chapters].reverse() };
    const { ai, of } = fakeAi();
    const result = await writeAndCheckGuide(ai, dossier, GAME, "live");
    expect(result.ok).toBe(true);
    expect(result.internalErrors).toEqual([
      'O capítulo crimson-forest veio depois de weeping-creek, mas no roteiro principal (PowerPyx) "Crimson Forest" vem antes de "Weeping Creek". Siga a ordem da fonte.',
      'O capítulo ashen-peak veio depois de weeping-creek, mas no roteiro principal (PowerPyx) "Ashen Peak" vem antes de "Weeping Creek". Siga a ordem da fonte.',
    ]);
    expect(of("guide-write").filter((o) => o.purpose.endsWith("-retry"))).toEqual([]);
  });
});

describe("guia pela lista da PSN (scope psn)", () => {
  const STEAM_PLUS: SteamAchievement[] = [...STEAM, steamAch("ACH_ARENA", "Arena Master", "Win every arena fight.")];
  /** One Steam-only achievement no source covers; PowerPyx lists the 4 PSN trophies + platinum. */
  const psnDossier = () =>
    buildDossier(
      STEAM_PLUS,
      [
        fact("PowerPyx", "roteiro_psn", {
          trophyListSize: 5,
          chapters: [
            chapter("Weeping Creek", [
              item("Bell", { collectibleType: "Bell", index: 1, total: 2, countsForEn: ["Bell Ringer"] }),
              item("Bell", { collectibleType: "Bell", index: 2, total: 2, countsForEn: ["Bell Ringer"] }),
            ], 1),
            chapter("Crimson Forest", [item("The Warden", { kind: "boss", location: "Arena", achievementNameEn: "Warden Down" })], 2),
          ],
          achievements: [ach("Bell Ringer"), ach("Warden Down"), ach("The End"), ach("Hidden Path"), ach("Lord of the Phantoms", { grade: "platinum" })],
          roadmap: [{ title: "Story playthrough", summary: "Play the story." }],
        }),
      ],
      [["https://example.com/powerpyx"]],
    );
  const game = { ...GAME, achievements: STEAM_PLUS, game: { ...GAME.game, achievementCount: STEAM_PLUS.length } };

  it("o payload sai com scope psn, a lista da PSN e as exclusivas da Steam, e passa no schema do site", async () => {
    const scoped = psnScope(psnDossier(), STEAM_PLUS);
    const { ai, of } = fakeAi({
      frame: (out) => {
        out.capa.chamadas[2] = { valor: "5", rotulo: "Troféus PSN" };
      },
    });
    const result = await writeAndCheckGuide(ai, scoped.dossier, game, "live", { scope: scoped.scope });
    expect(result.ok).toBe(true);
    const payload = result.payload;
    expect(guidePayloadSchema.safeParse(payload).error?.issues).toBeUndefined();
    expect(payload.walkthrough).toMatchObject({
      scope: "psn",
      psnList: { total: 5, names: ["Bell Ringer", "Warden Down", "The End", "Hidden Path", "Lord of the Phantoms"] },
      steamOnly: ["ACH_ARENA"],
    });
    // Every Steam achievement is an item or is in steamOnly, never both; the Steam-only one has no item.
    const covered = new Set(
      payload.walkthrough.chapters.flatMap((c) => c.steps.flatMap((s) => s.items.flatMap((i) => (i.achievement ? [i.achievement] : [])))),
    );
    for (const a of STEAM_PLUS) expect(covered.has(a.apiName) !== payload.walkthrough.steamOnly!.includes(a.apiName)).toBe(true);
    expect(walkAchievementRefs(walkthroughSchema.parse(payload.walkthrough)).map((r) => r.apiName)).not.toContain("ACH_ARENA");
    // The cover may cite the PSN count; the frame is told the guide follows the PSN list.
    expect(payload.walkthrough.cover.calls[2]).toEqual({ value: "5", label: "Troféus PSN" });
    const frame = of("guide-write-frame")[0]!.user;
    expect(frame).toContain("Troféus na lista da PSN: 5 (o guia segue esta lista)");
    expect(frame).toContain("Conquistas na Steam: 5, das quais 1 só na Steam (fora do roteiro, sem como fazer)");
    expect(frame).not.toContain("ACH_ARENA");
    // The checker gets the scope's numbers as authoritative too (the Steam-only ones are left out on purpose).
    const frameCheck = of("guide-check").find((c) => c.user.includes('"leiaAntes"'))!;
    expect(frameCheck.user.split("</numeros_do_codigo>")[0]).toContain('"listaDaPsn":{"trofeus":5,"conquistasSteam":5,"soNaSteamSemRoteiro":1}');
    expect(frameCheck.system).toMatch(/listaDaPsn/);
  });

  it("sem scope, o guia sai pela lista da Steam", async () => {
    const payload = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    expect(payload.walkthrough.scope).toBeUndefined();
    expect(payload.walkthrough.psnList).toBeUndefined();
    expect(payload.walkthrough.steamOnly).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Task 20: what the checker judges, and with which facts (systematic first-check failures)
// ---------------------------------------------------------------------------------------------

const section = (user: string, tag: "dossie" | "guia" | "moldura" | "avisos_do_codigo") => user.split(`<${tag}>`)[1]!.split(`</${tag}>`)[0]!;
const jobCheck = (calls: { purpose: string; user: string; system: string }[], stepKey: string) =>
  calls.find((c) => c.purpose === "guide-check" && section(c.user, "guia").includes(`"key":"${stepKey}"`))!;

describe("checador: julga cada parte só pelo que o escritor dela recebeu", () => {
  it("o trecho de um capítulo não julga o título nem o prazo do capítulo (são textos da moldura)", async () => {
    const { ai, calls } = fakeAi();
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    const weeping = jobCheck(calls, "weeping-creek-1");
    // The frame wrote "Antes da floresta" as the chapter's deadline and "Capítulo weeping-creek" as its title.
    expect(section(weeping.user, "guia")).not.toContain("Antes da floresta");
    expect(section(weeping.user, "guia")).not.toContain("Capítulo weeping-creek");
    // They are context for the step texts, in a block of their own: model text, never a dossier fact.
    expect(section(weeping.user, "dossie")).not.toContain("Capítulo weeping-creek");
    expect(section(weeping.user, "moldura")).toContain('"titulo":"Capítulo weeping-creek"');
    expect(section(weeping.user, "moldura")).toContain('"prazo":"Antes da floresta"');
    expect(weeping.system).toMatch(/<moldura>/);
  });

  it("o trecho recebe o jogo, os capítulos vizinhos e as conquistas sem lugar fixo que o escritor recebeu", async () => {
    const { ai, calls } = fakeAi();
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    const dossier = section(jobCheck(calls, "crimson-forest-1").user, "dossie");
    expect(dossier).toContain('"jogo":"Phantom Test"');
    expect(dossier).toContain('"anterior":"Weeping Creek"');
    expect(dossier).toContain('"proximo":"Ashen Peak"');
    // The writer of this job was offered the loose achievements (to place them): the checker sees the same facts.
    const loose = dossier.split('"conquistasSemLugarFixo"')[1]!;
    for (const apiName of ["ACH_BELLS", "ACH_ENDING", "ACH_SECRET"]) expect(loose).toContain(`"apiName":"${apiName}"`);
    // ...without the how-to the writer did not get either.
    expect(loose).not.toContain("Climb the scaffolding");
  });

  it("o aviso de perdível que o código põe no início do capítulo vai ao checador com a conquista avisada", async () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_ENDING")!, {
      missable: true,
      warnChapter: "Crimson Forest",
      doneChapter: "Crimson Forest",
    });
    const { ai, calls } = fakeAi();
    const result = await writeAndCheckGuide(ai, dossier, GAME, "live");
    const crimson = jobCheck(calls, "crimson-forest-1");
    // Task 21: the code's warning is not text to judge: it goes in a block of its own (see the Task 21 tests).
    expect(section(crimson.user, "avisos_do_codigo")).toContain("Perdível: as fontes ligam **The End** a este capítulo");
    const warned = section(crimson.user, "dossie").split('"conquistasAvisadasAqui"')[1]!;
    expect(warned).toContain('"apiName":"ACH_ENDING"');
    expect(warned).toContain('"perdivel":true');
    expect(result.ok).toBe(true);
  });

  it("a moldura é checada com o que o escritor da moldura recebeu: catálogo e números da ficha", async () => {
    const game = { ...GAME, game: { ...GAME.game, summary: "Um jogo de espadas e fantasmas." } };
    const { ai, of } = fakeAi();
    await writeAndCheckGuide(ai, makeDossier(), game, "live");
    const frame = of("guide-check").find((c) => c.user.includes('"leiaAntes"'))!;
    const dossier = section(frame.user, "dossie");
    expect(dossier).toContain('"nome":"Phantom Test"');
    expect(dossier).toContain('"desenvolvedora":"S-Game"');
    expect(dossier).toContain("Um jogo de espadas e fantasmas.");
    expect(dossier).toContain('"prazos":["Crimson Forest"]');
    const numbers = frame.user.split("</numeros_do_codigo>")[0]!;
    expect(numbers).toContain('"ficha":{"conquistas":4,"ocultas":2');
    expect(numbers).toContain('"capitulos":3');
  });

  it("o 'depois' de um capítulo longo é só o do trecho que tem o último passo dele", async () => {
    const dossier = makeDossier();
    const ashen = dossier.chapters.find((c) => c.title === "Ashen Peak")!;
    const base = ashen.items[0]!;
    ashen.items = Array.from({ length: 25 }, (_, n) => ({ ...base, id: `ash-${n}`, name: `Ash Feather ${n + 1}`, nameEn: `Ash Feather ${n + 1}` }));
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (!prompt.includes('capitulo key="ashen-peak"')) return;
        out.depois = prompt.includes('<passo key="ashen-peak-1">') ? "Nota do primeiro trecho." : null;
      },
    });
    const result = await writeAndCheckGuide(ai, dossier, GAME, "live");
    expect(JSON.stringify(result.payload)).not.toContain("Nota do primeiro trecho.");
  });

  it("perdível posto pelo código no lugar que o dossiê indica é nota, não problema: não paga reescrita", async () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!, {
      missable: true,
      missableUntil: "Crimson Forest",
      deadlineChapter: "Crimson Forest",
    });
    const { ai, of } = fakeAi();
    const result = await writeAndCheckGuide(ai, dossier, GAME, "live");
    expect(result.ok).toBe(true);
    expect(of("guide-write").filter((o) => o.purpose.endsWith("-retry"))).toEqual([]);
    // Still recorded with the draft, as a note.
    const note = result.draft!.repairs.find((r) => r.text.includes("ACH_SECRET"))!;
    expect(note).toMatchObject({ kind: "nota", scope: "weeping-creek-1" });
    expect(result.draft!.problems).toEqual([]);
  });
});

describe("rascunhos: nada pago se perde, e a próxima tentativa recomeça do último", () => {
  const failCrimson = (user: string) =>
    section(user, "guia").includes('"key":"crimson-forest-1"') ? { ok: false, problems: ["O passo crimson-forest-1 inventa um chefe."] } : OK;

  it("cada rodada vai a onRound com os textos, o payload e os problemas com escopo e tipo", async () => {
    const rounds: DraftRound[] = [];
    const { ai } = fakeAi({ verdict: failCrimson });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { onRound: (r) => rounds.push(r) });
    expect(result.ok).toBe(false);
    expect(rounds.map((r) => r.round)).toEqual([1, 2]);
    const last = rounds[1]!;
    expect(last.ok).toBe(false);
    expect(last.problems).toEqual([{ text: "O passo crimson-forest-1 inventa um chefe.", scope: "crimson-forest-1", kind: "checador" }]);
    expect(Object.keys(last.texts.jobs).sort()).toEqual(["ashen-peak-1", "crimson-forest-1", "limpeza-1", "weeping-creek-1"]);
    expect(last.texts.frame?.capa.manchete).toBeDefined();
    expect(last.payload.walkthrough.chapters.length).toBeGreaterThan(0);
    expect(result.draft).toEqual(last);
  });

  it("recomeçar de um rascunho reprovado reescreve só a parte com problema e só ela é checada de novo", async () => {
    const first = await writeAndCheckGuide(fakeAi({ verdict: failCrimson }).ai, makeDossier(), GAME, "live");
    const saved = JSON.parse(JSON.stringify(first.draft!)) as DraftRound;
    const { ai, of } = fakeAi();
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { resume: { texts: saved.texts, problems: saved.problems } });
    expect(result.ok).toBe(true);
    const writes = of("guide-write");
    expect(writes.map((w) => w.purpose)).toEqual(["guide-write-chapter-retry"]);
    expect(writes[0]!.user).toContain('<passo key="crimson-forest-1">');
    expect(writes[0]!.user).toContain("O passo crimson-forest-1 inventa um chefe.");
    // Only the rewritten job goes to the checker; the frame and the accepted jobs are not paid again.
    const checks = of("guide-check");
    expect(checks).toHaveLength(1);
    expect(section(checks[0]!.user, "guia")).toContain('"key":"crimson-forest-1"');
  });

  it("sonda: escreve só a moldura e os N primeiros capítulos, checa só essas partes e não reescreve", async () => {
    const rounds: DraftRound[] = [];
    const { ai, of } = fakeAi({ verdict: (user) => (user.includes('"leiaAntes"') ? { ok: false, problems: ["A capa exagera."] } : OK) });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { probe: { chapters: 1 }, onRound: (r) => rounds.push(r) });
    expect(of("guide-write").map((w) => w.purpose).sort()).toEqual(["guide-write-chapter", "guide-write-frame"]);
    expect(of("guide-write-chapter")[0]!.user).toContain('<passo key="weeping-creek-1">');
    expect(of("guide-check")).toHaveLength(2);
    expect(result.ok).toBe(false);
    // Only the probed parts' problems (the unwritten chapters' gaps are not problems of the probe).
    expect(result.draft!.problems).toEqual([{ text: "A capa exagera.", scope: "frame", kind: "checador" }]);
    expect(result.draft!.probe).toBe(true);
    expect(Object.keys(result.draft!.texts.jobs)).toEqual(["weeping-creek-1"]);
    expect(rounds).toHaveLength(1);
  });

  it("a rodada completa depois da sonda aproveita o que a sonda aprovou e escreve o resto", async () => {
    const probe = await writeAndCheckGuide(fakeAi().ai, makeDossier(), GAME, "live", { probe: { chapters: 1 } });
    expect(probe.draft!.problems).toEqual([]);
    const { ai, of } = fakeAi();
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { resume: { texts: probe.draft!.texts, problems: probe.draft!.problems } });
    expect(result.ok).toBe(true);
    // Frame and Weeping Creek were approved by the probe: only the other chapters are written (first time: no retry).
    expect(of("guide-write").map((w) => w.purpose).sort()).toEqual(["guide-write-chapter", "guide-write-chapter", "guide-write-chapter"]);
    expect(of("guide-write").some((w) => w.user.includes('<passo key="weeping-creek-1">'))).toBe(false);
    expect(of("guide-check").some((c) => c.user.includes('"leiaAntes"'))).toBe(false);
  });

  it("um rascunho salvo inválido não é aproveitado (parseSavedTexts)", () => {
    expect(parseSavedTexts({ frame: { capa: 1 }, jobs: { a: { passos: "x" } } })).toEqual({ frame: null, jobs: {} });
    expect(parseSavedTexts("lixo")).toBeUndefined();
  });
});

describe("texto de conquista sem lugar fixo posta pelo código (Task 20)", () => {
  const missableSecret = () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!, {
      missable: true,
      missableUntil: "Crimson Forest",
      deadlineChapter: "Crimson Forest",
    });
    return dossier;
  };

  it("sem texto, o problema vai para o trecho da limpeza (quem escreve esse texto) e o local não copia a fonte", async () => {
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (prompt.includes("capítulo de limpeza")) out.itens = out.itens.filter((i) => i.key !== "conq-ach-secret");
      },
    });
    const { payload, repairs } = await writeGuideDetailed(ai, missableSecret(), GAME, "live");
    const placed = itemsOf(payload).find((x) => x.i.achievement === "ACH_SECRET")!;
    expect(placed.step).toBe("weeping-creek-3");
    // ACH_SECRET's how-to is the source's own sentence: it never goes into the guide as the item's text.
    expect(placed.i.location).toBeUndefined();
    const missing = repairs.find((r) => r.text.includes("conq-ach-secret") && r.text.includes("sem texto"))!;
    expect(missing).toMatchObject({ scope: "limpeza-1", kind: "reparo" });
  });

  it("na sonda, um trecho sondado não é culpado pelo texto que a limpeza (não escrita) daria", async () => {
    const result = await writeAndCheckGuide(fakeAi().ai, missableSecret(), GAME, "live", { probe: { chapters: 1 } });
    expect(result.draft!.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("Task 20, revisão 1: sonda → rodada completa e checagem do que mudou", () => {
  const missableSecret = () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!, {
      missable: true,
      missableUntil: "Crimson Forest",
      deadlineChapter: "Crimson Forest",
    });
    return dossier;
  };
  const inGuia = (user: string, key: string) => section(user, "guia").includes(`"key":"${key}"`);
  /** The cleanup job writes new item texts when it is rewritten. */
  const newCleanupText = (out: { itens: { local: string }[] }, prompt: string) => {
    if (prompt.includes("capítulo de limpeza") && prompt.includes("Correções obrigatórias")) out.itens.forEach((i) => (i.local = "Texto novo da limpeza."));
  };

  it("rodada completa reprovada → sonda → rodada completa: o trecho reprovado fora da sonda é reescrito", async () => {
    const crimsonProblem = "O passo crimson-forest-1 inventa um chefe.";
    const full = await writeAndCheckGuide(
      fakeAi({ verdict: (user) => (inGuia(user, "crimson-forest-1") ? { ok: false, problems: [crimsonProblem] } : OK) }).ai,
      makeDossier(),
      GAME,
      "live",
    );
    expect(full.ok).toBe(false);
    const probe = await writeAndCheckGuide(fakeAi().ai, makeDossier(), GAME, "live", {
      probe: { chapters: 1 },
      resume: { texts: full.draft!.texts, problems: full.draft!.problems },
    });
    // The probe's own verdict is clean, but the failure outside its scope is still owed.
    expect(probe.draft!.problems).toEqual([]);
    expect(probe.draft!.pending).toEqual([{ text: crimsonProblem, scope: "crimson-forest-1", kind: "checador" }]);
    const { ai, of } = fakeAi();
    const again = await writeAndCheckGuide(ai, makeDossier(), GAME, "live", {
      resume: { texts: probe.draft!.texts, problems: [...probe.draft!.problems, ...probe.draft!.pending] },
    });
    expect(again.ok).toBe(true);
    const rewritten = of("guide-write").find((w) => w.user.includes('<passo key="crimson-forest-1">'))!;
    expect(rewritten.purpose).toBe("guide-write-chapter-retry");
    expect(rewritten.user).toContain(crimsonProblem);
    expect(again.draft!.pending).toEqual([]);
  });

  it("a limpeza reescreve o texto de um perdível posto pelo código: o trecho que mostra o item é checado de novo", async () => {
    let round1 = true;
    const { ai, calls } = fakeAi({
      chapter: (out, prompt) => newCleanupText(out, prompt),
      verdict: (user) => {
        if (round1 && inGuia(user, "limpeza-1")) {
          round1 = false;
          return { ok: false, problems: ["A limpeza erra o requisito."] };
        }
        return OK;
      },
    });
    const result = await writeAndCheckGuide(ai, missableSecret(), GAME, "live");
    expect(result.ok).toBe(true);
    const checks = calls.filter((c) => c.purpose === "guide-check");
    // Round 1: frame + 4 jobs. Round 2: the cleanup job and Weeping Creek, whose step shows ACH_SECRET's new text.
    const second = checks.slice(5);
    expect(second.some((c) => inGuia(c.user, "weeping-creek-3") && c.user.includes("Texto novo da limpeza."))).toBe(true);
  });

  it("moldura salva inválida: o rascunho ainda serve para ver o que mudou, e o trecho afetado é checado de novo", async () => {
    const failing = await writeAndCheckGuide(
      fakeAi({ verdict: (user) => (inGuia(user, "limpeza-1") ? { ok: false, problems: ["A limpeza erra o requisito."] } : OK) }).ai,
      missableSecret(),
      GAME,
      "live",
    );
    const { ai, calls, of } = fakeAi({ chapter: (out, prompt) => newCleanupText(out, prompt) });
    const result = await writeAndCheckGuide(ai, missableSecret(), GAME, "live", {
      resume: { texts: { ...failing.draft!.texts, frame: null }, problems: failing.draft!.problems },
    });
    expect(result.ok).toBe(true);
    expect(of("guide-write").map((w) => w.purpose).sort()).toEqual(["guide-write-chapter-retry", "guide-write-frame"]);
    const checks = calls.filter((c) => c.purpose === "guide-check");
    expect(checks.some((c) => inGuia(c.user, "weeping-creek-3"))).toBe(true);
  });

  it("o aviso do perdível sai mesmo quando o passo já tem outro aviso que não o cita", async () => {
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (!prompt.includes('<passo key="weeping-creek-3">')) return;
        out.passos.find((p) => p.key === "weeping-creek-3")!.blocos.unshift({ tipo: "aviso", texto: "Cuidado com a queda." } as never);
      },
    });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const step = payload.walkthrough.chapters.flatMap((c) => c.steps).find((s) => s.key === "weeping-creek-3")!;
    const avisos = step.body.filter((b) => b.type === "callout" && b.tone === "aviso").map((b) => (b as { text: string }).text);
    expect(avisos).toEqual(["Perdível: pegue **Nome weeping-creek-old-lantern** agora, antes de seguir.", "Cuidado com a queda."]);
  });

  it("um aviso do escritor que já cita o perdível não ganha um segundo aviso", async () => {
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (!prompt.includes('<passo key="weeping-creek-3">')) return;
        out.passos.find((p) => p.key === "weeping-creek-3")!.blocos.unshift({ tipo: "aviso", texto: "Perdível: pegue a Old Lantern antes da floresta." } as never);
      },
    });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const step = payload.walkthrough.chapters.flatMap((c) => c.steps).find((s) => s.key === "weeping-creek-3")!;
    expect(step.body.filter((b) => b.type === "callout" && b.tone === "aviso")).toHaveLength(1);
  });
});

describe("Task 20, revisão 2: o que a sonda mudou fora do escopo dela é checado na rodada seguinte", () => {
  const inGuia = (user: string, key: string) => section(user, "guia").includes(`"key":"${key}"`);
  /** ACH_ENDING: a loose missable done in Ashen Peak (the code puts it at the end of that chapter by default). */
  const doneInAshen = () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_ENDING")!, { missable: true, doneChapter: "Ashen Peak" });
    return dossier;
  };

  it("rodada completa → sonda que deixa de pôr a conquista → rodada completa: o trecho que passou a mostrá-la é checado, sem reescrita", async () => {
    // Full run: the Weeping Creek writer places ACH_ENDING in its step 2; the checker keeps failing Weeping Creek.
    const full = await writeAndCheckGuide(
      fakeAi({
        chapter: (out, prompt) => {
          if (prompt.includes('<passo key="weeping-creek-2">')) out.passos.find((p) => p.key === "weeping-creek-2")!.conquistas.push("ACH_ENDING");
        },
        verdict: (user) => (inGuia(user, "weeping-creek-1") ? { ok: false, problems: ["Weeping Creek inventa um atalho."] } : OK),
      }).ai,
      doneInAshen(),
      GAME,
      "live",
    );
    expect(full.ok).toBe(false);
    expect(itemsOf(full.payload).find((x) => x.i.achievement === "ACH_ENDING")!.step).toBe("weeping-creek-2");

    // Probe of Weeping Creek: its rewrite no longer places ACH_ENDING; the code puts it in Ashen Peak (out of scope).
    const probe = await writeAndCheckGuide(fakeAi().ai, doneInAshen(), GAME, "live", {
      probe: { chapters: 1 },
      resume: { texts: full.draft!.texts, problems: full.draft!.problems },
    });
    expect(itemsOf(probe.payload).find((x) => x.i.achievement === "ACH_ENDING")!.step).toBe("ashen-peak-1");
    expect(probe.draft!.problems).toEqual([]);
    expect(probe.draft!.pending).toEqual([expect.objectContaining({ scope: "ashen-peak-1", kind: "checagem-devida" })]);

    // Next full run: Ashen Peak is checked again (not rewritten); nothing else is paid.
    const { ai, of } = fakeAi();
    const again = await writeAndCheckGuide(ai, doneInAshen(), GAME, "live", {
      resume: { texts: probe.draft!.texts, problems: [...probe.draft!.problems, ...probe.draft!.pending] },
    });
    expect(again.ok).toBe(true);
    expect(of("guide-write")).toEqual([]);
    const checks = of("guide-check");
    expect(checks).toHaveLength(1);
    expect(inGuia(checks[0]!.user, "ashen-peak-1")).toBe(true);
    expect(checks[0]!.user).not.toContain("Correções obrigatórias");
  });

  it("a checagem devida reprovada faz o trecho ser reescrito", async () => {
    const full = await writeAndCheckGuide(fakeAi().ai, doneInAshen(), GAME, "live");
    const due = { text: "O trecho mudou na sonda e precisa ser checado de novo.", scope: "ashen-peak-1", kind: "checagem-devida" as const };
    let failed = false;
    const { ai, of } = fakeAi({
      verdict: (user) => {
        if (!failed && inGuia(user, "ashen-peak-1")) {
          failed = true;
          return { ok: false, problems: ["Ashen Peak erra o requisito."] };
        }
        return OK;
      },
    });
    const again = await writeAndCheckGuide(ai, doneInAshen(), GAME, "live", { resume: { texts: full.draft!.texts, problems: [due] } });
    expect(again.ok).toBe(true);
    const writes = of("guide-write");
    expect(writes.map((w) => w.purpose)).toEqual(["guide-write-chapter-retry"]);
    expect(writes[0]!.user).toContain("Ashen Peak erra o requisito.");
    expect(writes[0]!.user).not.toContain("precisa ser checado de novo");
  });

  it("'já citado' no aviso é por palavra inteira, não pedaço de palavra", async () => {
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (!prompt.includes('<passo key="weeping-creek-3">')) return;
        out.passos.find((p) => p.key === "weeping-creek-3")!.blocos.unshift({ tipo: "aviso", texto: "Fale com o Old Lanternkeeper antes." } as never);
      },
    });
    const payload = await writeGuide(ai, makeDossier(), GAME, "live");
    const step = payload.walkthrough.chapters.flatMap((c) => c.steps).find((s) => s.key === "weeping-creek-3")!;
    expect(step.body.filter((b) => b.type === "callout" && b.tone === "aviso")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 21: what the production probe showed (sonda-report.json)
// ---------------------------------------------------------------------------------------------

describe("Task 21: os avisos do código nomeiam o que avisam e não são julgados pelo checador", () => {
  const inGuia = (user: string, key: string) => section(user, "guia").includes(`"key":"${key}"`);
  const avisosOf = (payload: GuidePayloadV2, stepKey: string) =>
    payload.walkthrough.chapters
      .flatMap((c) => c.steps)
      .find((s) => s.key === stepKey)!
      .body.filter((b) => b.type === "callout" && b.tone === "aviso")
      .map((b) => (b as { text: string }).text);
  /** ACH_SECRET (hidden, loose) made missable until Crimson Forest; the Weeping Creek writer puts it in step 1 (a Bell). */
  const secretWithBell = () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_SECRET")!, {
      missable: true,
      missableUntil: "Crimson Forest",
      deadlineChapter: "Crimson Forest",
    });
    const placeInBellStep = (out: { passos: { key: string; conquistas: string[] }[] }, prompt: string) => {
      if (prompt.includes('<passo key="weeping-creek-1">')) out.passos.find((p) => p.key === "weeping-creek-1")!.conquistas.push("ACH_SECRET");
    };
    return { dossier, placeInBellStep };
  };
  /** ACH_ENDING and ACH_SECRET (hidden): loose missables the sources link to Crimson Forest (warned at its start), done in Ashen Peak. */
  const anchoredInCrimson = () => {
    const dossier = makeDossier();
    for (const apiName of ["ACH_ENDING", "ACH_SECRET"]) {
      Object.assign(dossier.achievements.find((a) => a.apiName === apiName)!, {
        missable: true,
        warnChapter: "Crimson Forest",
        doneChapter: "Ashen Peak",
        deadlineAssumed: true,
      });
    }
    return dossier;
  };

  it("num passo com mais de um item, o aviso nomeia o perdível (oculto entre ||), nunca 'o item deste passo'", async () => {
    const { dossier, placeInBellStep } = secretWithBell();
    const payload = await writeGuide(fakeAi({ chapter: placeInBellStep }).ai, dossier, GAME, "live");
    const step = payload.walkthrough.chapters[0]!.steps.find((s) => s.key === "weeping-creek-1")!;
    expect(step.items.map((i) => i.achievement ?? i.nameEn)).toEqual(["Bell", "ACH_SECRET"]);
    // Only what the dossier marks missable is warned (the Bell is not), by its name, as an achievement.
    expect(avisosOf(payload, "weeping-creek-1")).toEqual(["Perdível: pegue a conquista oculta ||Hidden Path|| agora, antes de seguir."]);
    expect(JSON.stringify(payload)).not.toContain("deste passo");
  });

  it("um perdível visível é nomeado em negrito; uma conquista visível, como conquista", async () => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_BELLS")!, { missable: true, missableUntil: "Crimson Forest", deadlineChapter: "Crimson Forest" });
    const payload = await writeGuide(
      fakeAi({
        chapter: (out, prompt) => {
          if (prompt.includes('<passo key="weeping-creek-3">')) out.passos.find((p) => p.key === "weeping-creek-3")!.conquistas.push("ACH_BELLS");
        },
      }).ai,
      dossier,
      GAME,
      "live",
    );
    expect(avisosOf(payload, "weeping-creek-3")).toEqual([
      "Perdível: pegue **Nome weeping-creek-old-lantern** e a conquista **Sineiro** agora, antes de seguir.",
    ]);
  });

  it("o aviso do início do capítulo diz o que o dossiê sustenta: as fontes ligam as conquistas a este capítulo", async () => {
    const payload = await writeGuide(fakeAi().ai, anchoredInCrimson(), GAME, "live");
    expect(avisosOf(payload, "crimson-forest-1")).toEqual([
      "Perdível: as fontes ligam **The End** e a conquista oculta ||Hidden Path|| a este capítulo; fique atento a partir daqui.",
    ]);
    expect(JSON.stringify(payload)).not.toContain("comece aqui");
  });

  it("o checador recebe os avisos do código à parte, com a base de cada um no dossiê, e não os julga", async () => {
    const dossier = anchoredInCrimson();
    const { ai, calls } = fakeAi();
    await writeAndCheckGuide(ai, dossier, GAME, "live");
    const crimson = jobCheck(calls, "crimson-forest-1");
    expect(crimson.system).toContain("<avisos_do_codigo>");
    // Not in the text to judge...
    expect(section(crimson.user, "guia")).not.toContain("Perdível");
    // ...but given apart, marked as the code's, with the facts the code wrote it from.
    const anchor = JSON.parse(section(crimson.user, "avisos_do_codigo"));
    expect(anchor.nota).toBe("escrito pelo código: não julgue");
    expect(anchor.avisos).toEqual([
      {
        passo: "crimson-forest-1",
        texto: "Perdível: as fontes ligam **The End** e a conquista oculta ||Hidden Path|| a este capítulo; fique atento a partir daqui.",
        base: [
          expect.objectContaining({ apiName: "ACH_ENDING", perdivel: true, avisar_em: "Crimson Forest", concluir_em: "Ashen Peak", prazo_suposto: true }),
          expect.objectContaining({ apiName: "ACH_SECRET", oculta: true, avisar_em: "Crimson Forest" }),
        ],
      },
    ]);
    // A step's own warning: the missable item and its milestone.
    const weeping = jobCheck(calls, "weeping-creek-1");
    expect(section(weeping.user, "guia")).not.toContain("Perdível: pegue");
    const item = JSON.parse(section(weeping.user, "avisos_do_codigo"));
    expect(item.avisos).toEqual([
      {
        passo: "weeping-creek-3",
        texto: "Perdível: pegue **Nome weeping-creek-old-lantern** agora, antes de seguir.",
        base: [expect.objectContaining({ key: "weeping-creek-old-lantern", perdivel: true, ate: "Crimson Forest" })],
      },
    ]);
    // A job with no code warning gets no block.
    const cleanup = calls.find((c) => c.purpose === "guide-check" && inGuia(c.user, "limpeza-1"))!;
    expect(cleanup.user).not.toContain("<avisos_do_codigo>");
  });

  it("o escritor é avisado (manual e mensagem do trecho) de não repetir nem ampliar os avisos do código", async () => {
    expect(loadGuideStyle()).toContain("Não repita nem amplie os avisos do sistema");
    const { ai, of } = fakeAi();
    await writeGuide(ai, anchoredInCrimson(), GAME, "live");
    const crimson = of("guide-write-chapter").find((c) => c.user.includes('<passo key="crimson-forest-1">'))!;
    expect(crimson.user).toContain("não os repita nem os amplie");
    expect(crimson.user).toContain(
      'No passo crimson-forest-1: "Perdível: as fontes ligam **The End** e a conquista oculta ||Hidden Path|| a este capítulo; fique atento a partir daqui."',
    );
    const weeping = of("guide-write-chapter").find((c) => c.user.includes('<passo key="weeping-creek-1">'))!;
    expect(weeping.user).toContain("não os repita nem os amplie");
    expect(weeping.user).not.toContain("No passo crimson-forest-1");
  });

  it("revisão: o que o checador achou correto não bloqueia, mas fica no rascunho como nota 'checador-correto'", async () => {
    const { ai } = fakeAi({
      verdict: (user) => (inGuia(user, "crimson-forest-1") ? { problems: [{ tipo: "correto", texto: "O chefe é o do dossiê." }] } : OK),
    });
    const result = await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    expect(result.ok).toBe(true);
    expect(result.draft!.problems).toEqual([]);
    expect(result.draft!.repairs).toContainEqual({ text: "O chefe é o do dossiê.", scope: "crimson-forest-1", kind: "checador-correto" });
  });

  it("revisão: o bloco do escritor igual a um aviso do código sai (o aviso não sai duplicado)", async () => {
    const anchor = "Perdível: as fontes ligam **The End** e a conquista oculta ||Hidden Path|| a este capítulo; fique atento a partir daqui.";
    const { ai } = fakeAi({
      chapter: (out, prompt) => {
        if (prompt.includes('<passo key="crimson-forest-1">')) out.passos.find((p) => p.key === "crimson-forest-1")!.blocos.unshift({ tipo: "aviso", texto: anchor } as never);
      },
    });
    const payload = await writeGuide(ai, anchoredInCrimson(), GAME, "live");
    expect(avisosOf(payload, "crimson-forest-1")).toEqual([anchor]);
  });

  it("revisão: o aviso do escritor no mesmo passo de um aviso do código fica no texto julgado", async () => {
    const { ai, calls } = fakeAi({
      chapter: (out, prompt) => {
        if (prompt.includes('<passo key="weeping-creek-3">')) out.passos.find((p) => p.key === "weeping-creek-3")!.blocos.unshift({ tipo: "aviso", texto: "Cuidado com a queda." } as never);
      },
    });
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    const weeping = jobCheck(calls, "weeping-creek-1");
    expect(section(weeping.user, "guia")).toContain("Cuidado com a queda.");
    expect(section(weeping.user, "guia")).not.toContain("Perdível: pegue");
    expect(section(weeping.user, "avisos_do_codigo")).toContain("Perdível: pegue **Nome weeping-creek-old-lantern** agora, antes de seguir.");
  });
});

describe("Task 22: o checador roda no modelo e no esforço do config", () => {
  it("writeAndCheckGuide usa MODEL_CHECK e CHECK_EFFORT; acima de high, mais saída e stream", async () => {
    const { ai, of } = fakeAi();
    const models = { MODEL_WRITER: "claude-opus-5-5", MODEL_CHECK: "modelo-do-checador", CHECK_EFFORT: "xhigh" as const };
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { models });
    const checks = of("guide-check");
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c).toMatchObject({ model: "modelo-do-checador", effort: "xhigh" });
      expect(c.maxTokens!).toBeGreaterThan(MAX_NONSTREAMING_TOKENS);
    }
    // The writer keeps its own model and effort.
    for (const w of of("guide-write")) expect(w).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
  });
});

describe("Task 23: a checagem de cópia de um rascunho retomado é refeita com a regra atual", () => {
  it("um problema de cópia salvo que a regra atual não acha não faz reescrever o trecho", async () => {
    const full = await writeAndCheckGuide(fakeAi().ai, makeDossier(), GAME, "live");
    expect(full.ok).toBe(true);
    const stale = { kind: "copia" as const, scope: "crimson-forest-1", text: 'Trecho copiado de uma fonte em o passo crimson-forest-1: "um nome conhecido". Reescreva.' };
    const { ai, of } = fakeAi();
    const again = await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { resume: { texts: full.draft!.texts, problems: [stale] } });
    expect(again.ok).toBe(true);
    expect(of("guide-write")).toEqual([]);
  });

  it("uma cópia que a regra atual ainda acha continua fazendo reescrever o trecho", async () => {
    const copied = "Climb the scaffolding and take the ladder on the right side to reach the second bell near the old well.";
    const full = await writeAndCheckGuide(fakeAi().ai, makeDossier(), GAME, "live");
    const texts = JSON.parse(JSON.stringify(full.draft!.texts)) as DraftRound["texts"];
    texts.jobs["crimson-forest-1"]!.passos[0]!.blocos = [{ tipo: "paragrafo", texto: copied }];
    const { ai, of } = fakeAi();
    const rounds: DraftRound[] = [];
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live", { resume: { texts, problems: [] }, onRound: (r) => rounds.push(r) });
    // Found on the resumed texts before writing: rewritten in the first round, not after a wasted check.
    expect(rounds.map((r) => [r.round, r.ok])).toEqual([[1, true]]);
    const rewrite = of("guide-write").find((w) => w.user.includes('<passo key="crimson-forest-1">'))!;
    expect(rewrite.purpose).toBe("guide-write-chapter-retry");
    expect(rewrite.user).toContain("Trecho copiado de uma fonte");
  });
});

// ---------------------------------------------------------------------------------------------
// Task 25 (R39): a "collect N" accepted short by less than one unit carries an honest note and goes to review
// ---------------------------------------------------------------------------------------------

describe("R39: contagem incompleta aceita", () => {
  const NOTE = "**The End** — As fontes localizam 38 de 40 Sha-Chi Amber Shards; 2 ainda não foram mapeados.";
  /** ACH_ENDING (loose, two sources) as a "collect 10" the sources locate 38 of 40 shards for. */
  const nearComplete = (located = 38) => {
    const dossier = makeDossier();
    Object.assign(dossier.achievements.find((a) => a.apiName === "ACH_ENDING")!, {
      collect: {
        target: 10,
        counted: located / 4,
        from: "texto",
        exact: false,
        conflictingTotals: [],
        withoutLocation: [],
        indexProblems: [],
        shortfallAccepted: { located, stated: 40, missing: 40 - located, label: "Sha-Chi Amber Shards", source: "PowerPyx" },
      },
    });
    return dossier;
  };
  const stepOf = (p: GuidePayloadV2, apiName: string) =>
    p.walkthrough.chapters.flatMap((c) => c.steps).find((s) => s.items.some((i) => i.achievement === apiName))!;

  it("a conquista sai com review true e o passo dela leva a nota do código (callout info) com os números do dossiê", async () => {
    const payload = await writeGuide(fakeAi().ai, nearComplete(), GAME, "live");
    const step = stepOf(payload, "ACH_ENDING");
    expect(step.items.find((i) => i.achievement === "ACH_ENDING")!.review).toBe(true);
    expect(step.body.filter((b) => b.type === "callout" && b.tone === "info").map((b) => (b as { text: string }).text)).toContain(NOTE);
    expect(walkthroughSchema.safeParse(payload.walkthrough).success).toBe(true);
    // Without the acceptance, no note.
    const plain = await writeGuide(fakeAi().ai, makeDossier(), GAME, "live");
    expect(JSON.stringify(plain)).not.toContain("ainda não foram mapeados");
  });

  it("um só faltando: 'ainda não foi mapeado'", async () => {
    const payload = await writeGuide(fakeAi().ai, nearComplete(39), GAME, "live");
    expect(JSON.stringify(stepOf(payload, "ACH_ENDING").body)).toContain("As fontes localizam 39 de 40 Sha-Chi Amber Shards; 1 ainda não foi mapeado.");
  });

  it("o escritor vê a contagem; o checador recebe a nota à parte, como texto do código, e não a julga", async () => {
    const { ai, calls, of } = fakeAi();
    await writeAndCheckGuide(ai, nearComplete(), GAME, "live");
    const step = calls.find((c) => c.purpose === "guide-check" && c.user.includes("ainda não foram mapeados"))!;
    expect(section(step.user, "guia")).not.toContain("ainda não foram mapeados");
    const warnings = JSON.parse(section(step.user, "avisos_do_codigo"));
    expect(warnings.avisos).toEqual([
      expect.objectContaining({ texto: NOTE, base: [expect.objectContaining({ apiName: "ACH_ENDING", localizados: 38, declarados: 40, faltam: 2 })] }),
    ]);
    expect(of("guide-write-chapter").some((c) => c.user.includes('contagem_incompleta="as fontes localizam 38 de 40 Sha-Chi Amber Shards; 2 sem mapa"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 29: names without nome_pt stay in English; foreign-only milestones are never translated
// ---------------------------------------------------------------------------------------------

describe("Task 29: regra fixa de nomes na mensagem da moldura e dos trechos", () => {
  const RULE =
    'Se `nome_pt` for nulo (vazio, `nome_pt=""`), use só o nome em inglês da conquista, sem tradução. ' +
    "Não traduza nem nomeie lugares, chefes ou marcos que o dossiê só traz em outro idioma: cite o marco como " +
    "'o ponto indicado pela fonte' ou use o nome em inglês que aparece no dossiê.";

  it("a moldura e cada trecho (e a reescrita) trazem a regra", async () => {
    const { ai, of } = fakeAi({ verdict: (_u, n) => (n === 0 ? { problems: ["Um problema."] } : OK) });
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live");
    const writes = of("guide-write");
    expect(writes.length).toBeGreaterThan(2);
    for (const w of writes) expect(w.user).toContain(RULE);
    expect(of("guide-write-frame")[0]!.user).toContain(RULE);
  });

  it("a regra não entra no manual de estilo nem na chave da escrita", () => {
    expect(loadGuideStyle()).not.toContain("o ponto indicado pela fonte");
  });
});

// ---------------------------------------------------------------------------------------------
// Task 30: rewrites see every past problem of the job; strict mode for stubborn jobs
// ---------------------------------------------------------------------------------------------

describe("Task 30: a reescrita vê todos os problemas já apontados no trecho", () => {
  const STRICT =
    "Escreva só o que o dossiê diz, com frases curtas; não acrescente localização, requisito, possibilidade de voltar, contagem de fontes ou tradução que não esteja escrita no dossiê; nomes que o dossiê só traz em chinês ou russo ficam como estão ou são omitidos.";
  const PAST = "Erros já apontados antes neste trecho: não repita nenhum";
  /** Saved texts of a whole first writing, to resume from. */
  async function savedTexts() {
    const rounds: DraftRound[] = [];
    await writeAndCheckGuide(fakeAi().ai, makeDossier(), GAME, "live", { onRound: (r) => rounds.push(r) });
    return rounds[0]!.texts;
  }
  const rewriteOf = (calls: { purpose: string; user: string }[], step: string) =>
    calls.find((c) => c.purpose === "guide-write-chapter-retry" && c.user.includes(`<passo key="${step}">`))!;

  it("um trabalho com problemas em 2 rodadas anteriores recebe as duas listas (atual e antigas, sem duplicata)", async () => {
    const texts = await savedTexts();
    const { ai, calls } = fakeAi();
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live", {
      resume: { texts, problems: [{ scope: "weeping-creek-1", text: "Notas do Colecionador é tradução inventada.", kind: "checador" }] },
      history: new Map([
        ["weeping-creek-1", { problems: ["Ouça Cada Flor é tradução inventada.", "Notas do Colecionador é tradução inventada."], flagged: 2 }],
      ]),
    });
    const user = rewriteOf(calls, "weeping-creek-1").user;
    const [current, past] = user.split(PAST);
    expect(current).toContain("## Correções obrigatórias");
    expect(current).toContain("- Notas do Colecionador é tradução inventada.");
    expect(past).toContain("- Ouça Cada Flor é tradução inventada.");
    expect(past).not.toContain("Notas do Colecionador");
    // Second rewrite of this job: not strict yet.
    expect(user).not.toContain(STRICT);
  });

  it("modo estrito a partir da 3ª reescrita do trabalho; os problemas de uma rodada desta execução entram no histórico", async () => {
    const texts = await savedTexts();
    const { ai, calls } = fakeAi({
      verdict: (user, n) => (n < 30 && user.includes('"key":"weeping-creek-1"') ? { problems: ["Mirage Estate não está no dossiê."] } : OK),
    });
    await writeAndCheckGuide(ai, makeDossier(), GAME, "live", {
      resume: { texts, problems: [{ scope: "weeping-creek-1", text: "Ouça Cada Flor é tradução inventada.", kind: "checador" }] },
      history: new Map([["weeping-creek-1", { problems: ["Ouça Cada Flor é tradução inventada."], flagged: 2 }]]),
    });
    const rewrites = calls.filter((c) => c.purpose === "guide-write-chapter-retry" && c.user.includes('<passo key="weeping-creek-1">'));
    expect(rewrites).toHaveLength(2);
    // 1st call here: the job's 2nd rewrite (flagged twice before); 2nd call: its 3rd → strict, with the round-1 problem as current.
    expect(rewrites[0]!.user).not.toContain(STRICT);
    expect(rewrites[1]!.user).toContain(STRICT);
    expect(rewrites[1]!.user.split(PAST)[0]).toContain("- Mirage Estate não está no dossiê.");
    expect(rewrites[1]!.user.split(PAST)[1]).toContain("- Ouça Cada Flor é tradução inventada.");
  });
});
