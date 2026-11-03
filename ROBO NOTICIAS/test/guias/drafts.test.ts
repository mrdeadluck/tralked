import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carriedDraft, describeDraft, groupProblems, latestDraft, resumableDraft, saveDraft, writeReportFile } from "../../src/guias/drafts.js";
import { openGuideDb } from "../../src/guias/db.js";
import type { DraftRound } from "../../src/guias/writer.js";

const frame = {
  capa: { chamadas: [], manchete: "M", linhaFina: "L" },
  ficha: { dificuldade: 3, justificativaDificuldade: "J", notaZeradas: "Z", maisDificil: null },
  visaoGeral: ["V"],
  leiaAntes: [],
  etapas: [],
  capitulos: [],
};

const round = (over: Partial<DraftRound> = {}): DraftRound => ({
  round: 2,
  ok: false,
  probe: false,
  texts: { frame, jobs: { "cap-1": { passos: [], itens: [], depois: null } } },
  payload: { format: 2 } as unknown as DraftRound["payload"],
  problems: [
    { text: "O passo cap-1 inventa um chefe.", scope: "cap-1", kind: "checador" },
    { text: "Trecho copiado de uma fonte em o passo cap-1.", scope: "cap-1", kind: "copia" },
    { text: "A capa exagera.", scope: "frame", kind: "checador" },
  ],
  repairs: [{ text: "O sistema pôs a conquista X no passo cap-1-3.", scope: "cap-1", kind: "nota" }],
  internalErrors: [],
  pending: [],
  ...over,
});

describe("rascunhos no GuideDb", () => {
  it("cada rodada é salva com payload, problemas (escopo e tipo), reparos e textos; a última volta inteira", () => {
    const db = openGuideDb(":memory:");
    saveDraft(db, { requestId: "direto-1", attempt: 1, writingKey: "escrita:a", draft: round({ round: 1 }), at: new Date("2026-11-03T10:00:00Z") });
    saveDraft(db, { requestId: "direto-1", attempt: 1, writingKey: "escrita:a", draft: round(), at: new Date("2026-11-03T11:00:00Z") });
    const last = latestDraft(db, "direto-1")!;
    expect(last).toMatchObject({ requestId: "direto-1", attempt: 1, round: 2, ok: false, probe: false, writingKey: "escrita:a", createdAt: "2026-11-03T11:00:00.000Z" });
    expect(last.problems).toHaveLength(3);
    expect(last.repairs[0]!.kind).toBe("nota");
    expect(last.texts?.jobs["cap-1"]).toBeDefined();
    expect(latestDraft(db, "outro")).toBeUndefined();
  });

  it("o rascunho para recomeçar é o último da mesma chave de escrita, de qualquer pedido, com textos válidos", () => {
    const db = openGuideDb(":memory:");
    saveDraft(db, { requestId: "req-a", attempt: 1, writingKey: "escrita:a", draft: round(), at: new Date("2026-11-03T10:00:00Z") });
    saveDraft(db, { requestId: "req-b", attempt: 1, writingKey: "escrita:b", draft: round(), at: new Date("2026-11-03T11:00:00Z") });
    const resume = resumableDraft(db, "escrita:a")!;
    expect(resume.requestId).toBe("req-a");
    expect(resume.texts.frame?.capa.manchete).toBe("M");
    expect(resume.problems.map((p) => p.scope)).toEqual(["cap-1", "cap-1", "frame"]);
    expect(resumableDraft(db, "escrita:nenhuma")).toBeUndefined();
    // A probe's draft also carries the failures it did not judge (outside its chapters): the resume rewrites them.
    const owed = { text: "O passo cap-9 inventa um chefe.", scope: "cap-9", kind: "checador" as const };
    saveDraft(db, { requestId: "req-a", attempt: 2, writingKey: "escrita:a", draft: round({ probe: true, problems: [], pending: [owed] }), at: new Date() });
    expect(resumableDraft(db, "escrita:a")!.problems).toEqual([owed]);
    expect(latestDraft(db, "req-a")!.pending).toEqual([owed]);
    expect(describeDraft(latestDraft(db, "req-a")!)).toContain("pendentes de antes, fora da sonda (1):");
    // A draft without texts (a fake stage, a corrupt row) is not a starting point.
    saveDraft(db, { requestId: "req-c", attempt: 1, writingKey: "escrita:c", draft: { ...round(), texts: null }, at: new Date() });
    expect(resumableDraft(db, "escrita:c")).toBeUndefined();
  });

  it("problemas agrupados por tipo e escopo, com contagens", () => {
    const lines = groupProblems(round().problems);
    expect(lines[0]).toBe("3 problemas");
    expect(lines).toContain("checador (2):");
    expect(lines).toContain("  frame (1):");
    expect(lines).toContain("  cap-1 (1):");
    expect(lines).toContain("    - O passo cap-1 inventa um chefe.");
    expect(lines).toContain("copia (1):");
    expect(groupProblems([])).toEqual(["0 problemas"]);
  });

  it("describeDraft: cabeçalho, problemas agrupados e as notas do código", () => {
    const db = openGuideDb(":memory:");
    saveDraft(db, { requestId: "direto-1", attempt: 3, writingKey: "escrita:a", draft: round({ probe: true, round: 1 }), at: new Date("2026-11-03T11:00:00Z") });
    const text = describeDraft(latestDraft(db, "direto-1")!).join("\n");
    expect(text).toContain("rascunho de direto-1, tentativa 3, rodada 1 (sonda), 2026-11-03T11:00:00.000Z: reprovado");
    expect(text).toContain("3 problemas");
    expect(text).toContain("notas e reparos do código e do checador, não bloqueiam (1)");
  });

  it("o relatório vai para relatorios/<pedido>-<tentativa>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "guias-"));
    const path = writeReportFile(dir, "direto-1", 2, { status: "failed", problems: round().problems });
    expect(path).toBe(join(dir, "relatorios", "direto-1-2.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ status: "failed", problems: [{ scope: "cap-1", kind: "checador" }, {}, {}] });
  });

  describe("Task 21: rascunho de outra versão do escritor (mesmas entradas)", () => {
    const job = { passos: [], itens: [], depois: null };
    /** Frame, cap-1 and cap-2 failed; cap-3 is owed a check; cap-4 and cap-5 were accepted. */
    const older = (over: Partial<DraftRound> = {}) =>
      round({
        texts: { frame, jobs: { "cap-1": job, "cap-2": job, "cap-3": job, "cap-4": job, "cap-5": job } },
        problems: [
          { text: "O passo cap-1 inventa um chefe.", scope: "cap-1", kind: "checador" },
          { text: "A capa exagera.", scope: "frame", kind: "checador" },
        ],
        pending: [
          { text: "O passo cap-2 inventa um atalho.", scope: "cap-2", kind: "checador" },
          { text: "O trecho cap-3 mudou com a sonda.", scope: "cap-3", kind: "checagem-devida" },
        ],
        ...over,
      });
    const keys = { writingKey: "escrita:nova", baseKey: "base:x" };

    it("só os trechos que o checador aprovou passam, e são checados de novo (sem reescrita); a moldura é escrita de novo", () => {
      const db = openGuideDb(":memory:");
      saveDraft(db, { requestId: "direto-1", attempt: 2, writingKey: "escrita:velha", baseKey: "base:x", draft: older({ probe: true }), at: new Date() });
      const carried = carriedDraft(db, keys)!;
      expect(carried).toMatchObject({ requestId: "direto-1", attempt: 2, probe: true, writingKey: "escrita:velha" });
      expect(carried.texts).toEqual({ frame: null, jobs: { "cap-4": job, "cap-5": job } });
      expect(carried.problems).toEqual([
        { scope: "cap-4", kind: "checagem-devida", text: "O trecho cap-4 vem de uma versão anterior do escritor e precisa ser checado de novo." },
        { scope: "cap-5", kind: "checagem-devida", text: "O trecho cap-5 vem de uma versão anterior do escritor e precisa ser checado de novo." },
      ]);
    });

    it("nada passa de outras entradas, da mesma chave (é o resumableDraft) ou sem trecho aprovado", () => {
      const db = openGuideDb(":memory:");
      saveDraft(db, { requestId: "a", attempt: 1, writingKey: "escrita:velha", baseKey: "base:outra", draft: older(), at: new Date() });
      expect(carriedDraft(db, keys)).toBeUndefined();
      saveDraft(db, { requestId: "b", attempt: 1, writingKey: "escrita:nova", baseKey: "base:x", draft: older(), at: new Date() });
      expect(carriedDraft(db, keys)).toBeUndefined();
      const allFailed = older({ problems: ["cap-1", "cap-2", "cap-3", "cap-4", "cap-5"].map((scope) => ({ text: "x", scope, kind: "checador" as const })) });
      saveDraft(db, { requestId: "c", attempt: 1, writingKey: "escrita:velha", baseKey: "base:x", draft: allFailed, at: new Date() });
      expect(carriedDraft(db, keys)).toBeUndefined();
    });

    it("Task 22: um rascunho salvo com a chave de base antiga (com o Haiku do checador) é carregado", () => {
      const db = openGuideDb(":memory:");
      saveDraft(db, { requestId: "direto-1", attempt: 3, writingKey: "escrita:v5-haiku", baseKey: "base:antiga", draft: older({ probe: true }), at: new Date() });
      expect(carriedDraft(db, keys)).toBeUndefined();
      const carried = carriedDraft(db, { ...keys, earlierBaseKeys: ["base:antiga"] })!;
      expect(carried).toMatchObject({ requestId: "direto-1", attempt: 3, baseKey: "base:antiga" });
      expect(carried.texts).toEqual({ frame: null, jobs: { "cap-4": job, "cap-5": job } });
      expect(carried.problems.map((p) => p.kind)).toEqual(["checagem-devida", "checagem-devida"]);
    });

    it("um rascunho de antes da chave de base é achado pela chave que a versão de então daria", () => {
      const db = openGuideDb(":memory:");
      saveDraft(db, { requestId: "direto-1", attempt: 2, writingKey: "escrita:v4", draft: older(), at: new Date() });
      expect(carriedDraft(db, keys)).toBeUndefined();
      const carried = carriedDraft(db, { ...keys, earlierKeys: ["escrita:v4"] })!;
      expect(Object.keys(carried.texts.jobs)).toEqual(["cap-4", "cap-5"]);
    });
  });
});
