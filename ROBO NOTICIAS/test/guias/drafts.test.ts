import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carriedDraft, describeDraft, groupProblems, latestDraft, problemHistory, resumableDraft, saveDraft, writeReportFile } from "../../src/guias/drafts.js";
import { openGuideDb } from "../../src/guias/db.js";
import { MIN_CARRIED_VERSION, WRITER_CACHE_VERSION } from "../../src/guias/writing-cache.js";
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

    it("um rascunho de versão abaixo de MIN_CARRIED_VERSION (v8) não é carregado (reescrita completa); um v9 é", () => {
      expect(MIN_CARRIED_VERSION).toBe(9);
      const db = openGuideDb(":memory:");
      saveDraft(db, { requestId: "a", attempt: 1, writingKey: "escrita:v8", baseKey: "base:x", writerVersion: 8, draft: older(), at: new Date() });
      expect(carriedDraft(db, keys)).toBeUndefined();
      saveDraft(db, { requestId: "b", attempt: 1, writingKey: "escrita:v9-outro-manual", baseKey: "base:x", writerVersion: 9, draft: older(), at: new Date() });
      const carried = carriedDraft(db, keys)!;
      expect(carried).toMatchObject({ requestId: "b", writerVersion: 9 });
      expect(Object.keys(carried.texts.jobs)).toEqual(["cap-4", "cap-5"]);
      // A newer v8 draft does not hide the v9 one.
      saveDraft(db, { requestId: "c", attempt: 1, writingKey: "escrita:v8", baseKey: "base:x", writerVersion: 8, draft: older(), at: new Date() });
      expect(carriedDraft(db, keys)).toMatchObject({ requestId: "b" });
    });

    it("voz v2: um rascunho sem versão gravada (salvo antes dela) nunca é carregado, nem pelas chaves antigas", () => {
      const db = openGuideDb(":memory:");
      // A row as the code before v7 wrote it: no writer_version.
      db.raw
        .prepare("INSERT INTO drafts (request_id, attempt, writing_key, created_at, round, ok, probe, payload_json, problems_json, repairs_json, internal_errors_json, texts_json, base_key) VALUES ('d', 1, 'escrita:v5-haiku', '2026-11-03', 1, 0, 1, '{}', '[]', '[]', '[]', ?, 'base:antiga')")
        .run(JSON.stringify({ frame: null, jobs: { "cap-4": job } }));
      expect(carriedDraft(db, { ...keys, earlierBaseKeys: ["base:antiga"], earlierKeys: ["escrita:v5-haiku"] })).toBeUndefined();
    });

    it("o rascunho da mesma chave continua sendo retomado, com a versão gravada", () => {
      const db = openGuideDb(":memory:");
      saveDraft(db, { requestId: "a", attempt: 1, writingKey: "escrita:nova", baseKey: "base:x", draft: older(), at: new Date() });
      expect(resumableDraft(db, "escrita:nova")).toMatchObject({ requestId: "a", writerVersion: WRITER_CACHE_VERSION });
    });
  });
});

describe("Task 30: histórico de problemas por trecho (mesmo pedido, mesma chave base, todas as tentativas e rodadas)", () => {
  it("junta os problemas do checador e de cópia de cada trecho, sem duplicatas, e conta as rodadas que o apontaram", () => {
    const db = openGuideDb(":memory:");
    const at = new Date("2026-11-03T10:00:00Z");
    const p = (text: string, scope: string, kind: "checador" | "copia" | "reparo" | "nota" = "checador") => ({ text, scope, kind });
    const save = (requestId: string, attempt: number, baseKey: string, problems: ReturnType<typeof p>[], writingKey = "escrita:a") =>
      saveDraft(db, { requestId, attempt, writingKey, baseKey, draft: round({ problems }), at });
    save("direto-1", 12, "base:x", [p("Ouça Cada Flor é tradução inventada.", "limpeza-37"), p("Mirage Estate não está no dossiê.", "frame")]);
    save("direto-1", 13, "base:x", [p("Notas do Colecionador é tradução inventada.", "limpeza-37"), p("Trecho copiado.", "limpeza-37", "copia")], "escrita:b");
    save("direto-1", 13, "base:x", [p("Ouça Cada Flor é tradução inventada.", "limpeza-37"), p("O passo ficou sem texto.", "limpeza-37", "reparo")]);
    // Another request or another base key: not this writing.
    save("direto-2", 1, "base:x", [p("De outro pedido.", "limpeza-37")]);
    save("direto-1", 13, "base:y", [p("De outra chave base.", "limpeza-37")]);

    const h = problemHistory(db, { requestId: "direto-1", baseKey: "base:x" });
    expect(h.get("limpeza-37")).toEqual({
      problems: ["Ouça Cada Flor é tradução inventada.", "Notas do Colecionador é tradução inventada.", "Trecho copiado."],
      flagged: 3,
    });
    expect(h.get("frame")).toEqual({ problems: ["Mirage Estate não está no dossiê."], flagged: 1 });
    expect(problemHistory(db, { requestId: "direto-9", baseKey: "base:x" }).size).toBe(0);
  });
});

describe("salvar antes da checagem: as linhas de antes da checagem saem quando a rodada checada chega", () => {
  it("a rodada checada apaga as linhas pré-checagem mais antigas do mesmo pedido e chave; as outras ficam", () => {
    const db = openGuideDb(":memory:");
    const at = new Date("2026-11-03T10:00:00Z");
    const save = (requestId: string, writingKey: string, checked: boolean) => saveDraft(db, { requestId, attempt: 1, writingKey, checked, draft: round(), at });
    save("a", "escrita:x", false);
    save("a", "escrita:y", false);
    save("b", "escrita:x", false);
    save("a", "escrita:x", true);
    const rows = () => db.raw.prepare("SELECT request_id, writing_key, checked FROM drafts ORDER BY id").all() as { request_id: string; writing_key: string; checked: number }[];
    expect(rows().map((r) => [r.request_id, r.writing_key, r.checked])).toEqual([
      ["a", "escrita:y", 0],
      ["b", "escrita:x", 0],
      ["a", "escrita:x", 1],
    ]);
    // A newer pre-check row (the next round, written) stays, and resumes over the checked one.
    save("a", "escrita:x", false);
    expect(rows().filter((r) => r.request_id === "a" && r.writing_key === "escrita:x").map((r) => r.checked)).toEqual([1, 0]);
    expect(resumableDraft(db, "escrita:x")!.requestId).toBe("a");
  });
});
