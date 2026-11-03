import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeDraft, groupProblems, latestDraft, resumableDraft, saveDraft, writeReportFile } from "../../src/guias/drafts.js";
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
    expect(text).toContain("notas e reparos do código (1)");
  });

  it("o relatório vai para relatorios/<pedido>-<tentativa>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "guias-"));
    const path = writeReportFile(dir, "direto-1", 2, { status: "failed", problems: round().problems });
    expect(path).toBe(join(dir, "relatorios", "direto-1-2.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ status: "failed", problems: [{ scope: "cap-1", kind: "checador" }, {}, {}] });
  });
});
