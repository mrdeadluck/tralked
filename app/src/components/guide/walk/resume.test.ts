import { describe, expect, it } from "vitest";
import { cleanupChapter, resumeItems, resumeOf, type ResumeItem } from "./resume";

/*
 * Two story chapters of three steps (one item each) and the cleanup chapter (two loose achievements).
 * a2 is missable; b1 is an achievement the cleanup also lists (same apiName on two items).
 */
const item = (ref: string, chapter: number, step: string, over: Partial<ResumeItem> = {}): ResumeItem => ({
  ref,
  chapter,
  step,
  missable: false,
  cleanup: false,
  loose: false,
  achievementId: null,
  countsFor: [],
  ...over,
});

const ITEMS: ResumeItem[] = [
  item("a1", 0, "1.1"),
  item("a2", 0, "1.2", { missable: true }),
  item("a3", 0, "1.3"),
  item("b1", 1, "2.1", { achievementId: "ach-b1" }),
  item("b2", 1, "2.2"),
  item("b3", 1, "2.3"),
  item("z1", 2, "3.1", { cleanup: true, loose: true, achievementId: "ach-z1" }),
  item("z2", 2, "3.2", { cleanup: true, loose: true, achievementId: "ach-b1" }),
];

const run = (ticked: string[], unlocked: string[] = []) =>
  resumeOf(ITEMS, {
    isTicked: (ref) => ticked.includes(ref),
    isUnlocked: (id) => unlocked.includes(id),
  });

describe("resumeOf", () => {
  it("nada feito: começa no primeiro item, sem capítulo passado", () => {
    expect(run([])).toEqual({
      furthest: null,
      resume: { ref: "a1", chapter: 0, step: "1.1" },
      behind: [],
      possiblyMissed: [],
      passedChapters: [],
      evidence: "nenhum",
    });
  });

  it("progresso linear: o próximo depois do mais adiante", () => {
    const r = run(["a1", "a2", "a3", "b1"]);
    expect(r.furthest).toBe(3);
    expect(r.resume).toEqual({ ref: "b2", chapter: 1, step: "2.2" });
    expect(r.behind).toEqual([]);
    expect(r.passedChapters).toEqual([0]);
    expect(r.evidence).toBe("itens");
  });

  it("itens pulados ficam para trás, e o retorno não volta para eles", () => {
    const r = run(["a1", "b2"]);
    expect(r.resume?.ref).toBe("b3");
    expect(r.behind).toEqual(["a2", "a3", "b1"]);
    expect(r.passedChapters).toEqual([0]);
  });

  it("conquista fora de ordem na limpeza não mexe no mais adiante", () => {
    const r = run(["a1"], ["ach-z1"]);
    expect(r.furthest).toBe(0);
    expect(r.resume?.ref).toBe("a2");
    expect(r.evidence).toBe("itens");
  });

  it("apiName em dois itens conta o primeiro (a limpeza repete a conquista)", () => {
    const r = run([], ["ach-b1"]);
    expect(r.furthest).toBe(3);
    expect(r.resume?.ref).toBe("b2");
    // The cleanup item of the same achievement shows as done too.
    expect(run(["a1", "a2", "a3", "b2", "b3", "z1"], ["ach-b1"]).resume).toBeNull();
  });

  it("guia concluído: resume null e todo capítulo passado", () => {
    const r = run(["a1", "a2", "a3", "b1", "b2", "b3", "z1", "z2"]);
    expect(r.resume).toBeNull();
    expect(r.behind).toEqual([]);
    expect(r.possiblyMissed).toEqual([]);
    expect(r.passedChapters).toEqual([0, 1, 2]);
  });

  it("guia concluído com itens para trás: eles ficam em behind, fora da limpeza", () => {
    const r = run(["a1", "a3", "b1", "b2", "b3", "z1"], ["ach-b1"]);
    expect(r.resume).toBeNull();
    expect(r.behind).toEqual(["a2"]);
    expect(r.possiblyMissed).toEqual(["a2"]);
  });

  it("perdível não feito de um capítulo que ficou para trás: talvez perdido", () => {
    const r = run(["a1", "a3"]);
    expect(r.resume?.ref).toBe("b1");
    expect(r.possiblyMissed).toEqual(["a2"]);
    // Still ahead of the visitor: not missed.
    expect(run(["a1"]).possiblyMissed).toEqual([]);
  });

  it("perdível pulado no capítulo atual não é talvez perdido (ainda dá para pegar)", () => {
    const items = [...ITEMS.slice(0, 3), item("a4", 0, "1.4"), ...ITEMS.slice(3)];
    const r = resumeOf(items, { isTicked: (ref) => ["a1", "a3"].includes(ref), isUnlocked: () => false });
    expect(r.resume?.ref).toBe("a4");
    expect(r.behind).toEqual(["a2"]);
    expect(r.possiblyMissed).toEqual([]);
  });

  it("perdível da limpeza não conta enquanto o retorno está na história", () => {
    const items = [...ITEMS, item("z3", 2, "3.3", { cleanup: true, missable: true })];
    expect(resumeOf(items, { isTicked: (ref) => ref === "a1" || ref === "a2", isUnlocked: () => false }).possiblyMissed).toEqual([]);
  });

  it("feito só pelo desbloqueio: conta como feito e a evidência são as conquistas", () => {
    const r = run([], ["ach-b1"]);
    expect(r.evidence).toBe("conquistas");
    expect(r.behind).toEqual(["a1", "a2", "a3"]);
    expect(r.possiblyMissed).toEqual(["a2"]);
    expect(r.passedChapters).toEqual([0]);
    expect(run(["a1"], ["ach-b1"]).evidence).toBe("ambos");
  });

  it("capítulo com tudo feito acende mesmo depois do retorno", () => {
    expect(run(["a1", "z1", "z2"]).passedChapters).toEqual([2]);
  });

  describe("itens que só contam para uma conquista (countsFor)", () => {
    /*
     * Chapter 0: three herbs (h2 missable) for the quest achievement "ach-q", which the quest item q
     * is; chapter 1: c1 and c2 count toward "collect all" (ach-all) and toward ach-q + ach-all.
     */
    const HERBS: ResumeItem[] = [
      item("h1", 0, "1.1", { countsFor: ["ach-q"] }),
      item("h2", 0, "1.2", { countsFor: ["ach-q"], missable: true }),
      item("h3", 0, "1.3", { countsFor: ["ach-q"] }),
      item("q", 0, "1.4", { achievementId: "ach-q" }),
      item("b1", 1, "2.1"),
      item("c1", 1, "2.2", { countsFor: ["ach-all"] }),
      item("c2", 1, "2.3", { countsFor: ["ach-q", "ach-all"] }),
      item("b2", 1, "2.4"),
    ];
    const herbs = (ticked: string[], unlocked: string[]) =>
      resumeOf(HERBS, { isTicked: (ref) => ticked.includes(ref), isUnlocked: (id) => unlocked.includes(id) });

    it("com a conquista desbloqueada as ervas contam como feitas: nada para trás, nada talvez perdido", () => {
      const r = herbs(["b1"], ["ach-q"]);
      expect(r.resume?.ref).toBe("c1");
      expect(r.behind).toEqual([]);
      expect(r.possiblyMissed).toEqual([]);
      expect(r.passedChapters).toEqual([0]);
    });

    it('feito só pelo countsFor não mexe no mais adiante ("colete todos" desbloqueado não joga para frente)', () => {
      const r = herbs([], ["ach-all"]);
      expect(r.furthest).toBeNull();
      expect(r.evidence).toBe("nenhum");
      expect(r.resume?.ref).toBe("h1");
      // c1 is done (its only achievement is unlocked); c2 needs ach-q too.
      expect(herbs(["b1"], ["ach-all"]).resume?.ref).toBe("c2");
    });

    it("todas as conquistas de countsFor são precisas, e countsFor vazio nunca conta", () => {
      const r = herbs(["q", "b1"], ["ach-all"]);
      expect(r.resume?.ref).toBe("c2");
      expect(r.behind).toEqual(["h1", "h2", "h3"]);
      expect(r.possiblyMissed).toEqual(["h2"]);
      expect(herbs(["q"], ["ach-q", "ach-all"]).resume?.ref).toBe("b1");
    });

    it("lista filtrada (versão PlayStation): o mesmo predicado por item", () => {
      const ps = HERBS.filter((i) => i.ref !== "c1");
      const r = resumeOf(ps, { isTicked: (ref) => ref === "b1", isUnlocked: (id) => id === "ach-q" });
      expect(r.resume?.ref).toBe("c2");
      expect(r.behind).toEqual([]);
    });
  });
});

describe("resumeItems", () => {
  const chapters = [
    { key: "regiao-1", refs: ["a1", "a2", "a3"], steps: [2, 1], missables: [{ ref: "a2", name: "Erva" }], cleanup: false },
    { key: "limpeza", refs: ["z1"], steps: [1], missables: [], cleanup: true },
  ];

  it("lista os itens em ordem com passo, perdível, limpeza, conquista e countsFor", () => {
    const items = resumeItems(
      chapters,
      (ref) => (ref === "z1" ? "ach-z1" : null),
      (ref) => (ref === "a1" ? ["ach-q"] : []),
    );
    expect(items).toEqual([
      item("a1", 0, "1.1", { countsFor: ["ach-q"] }),
      item("a2", 0, "1.1", { missable: true }),
      item("a3", 0, "1.2"),
      item("z1", 1, "2.1", { cleanup: true, loose: true, achievementId: "ach-z1" }),
    ]);
  });

  it("a limpeza é o último capítulo com a chave do robô", () => {
    expect(cleanupChapter("limpeza", 4, 5)).toBe(true);
    expect(cleanupChapter("limpeza-2", 4, 5)).toBe(true);
    expect(cleanupChapter("limpeza", 2, 5)).toBe(false);
    expect(cleanupChapter("crimson-forest", 4, 5)).toBe(false);
  });
});
