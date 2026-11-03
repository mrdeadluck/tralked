import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGuiaArgs, showDraft } from "../../src/commands/guia.js";
import { openGuideDb } from "../../src/guias/db.js";
import { saveDraft } from "../../src/guias/drafts.js";

describe("pnpm guia: rascunho e sonda (Task 20)", () => {
  it("--rascunho <pedido> [--dados <dir>]", () => {
    expect(parseGuiaArgs(["--", "--rascunho", "direto-4115450"])).toEqual({ dryRun: false, draft: { requestId: "direto-4115450" } });
    expect(parseGuiaArgs(["--rascunho", "abc", "--dados", "/tmp/copia"])).toEqual({ dryRun: false, draft: { requestId: "abc", dataDir: "/tmp/copia" } });
    expect(() => parseGuiaArgs(["--rascunho"])).toThrow("--rascunho <pedido>");
  });

  it("--sonda [--capitulos N] só no modo direto; padrão 2 capítulos", () => {
    expect(parseGuiaArgs(["--", "--appid", "4115450", "--sonda"])).toEqual({
      dryRun: false,
      direct: { appId: 4115450, update: false, probe: { chapters: 2 } },
    });
    expect(parseGuiaArgs(["--appid", "4115450", "--sonda", "--capitulos", "3"])).toEqual({
      dryRun: false,
      direct: { appId: 4115450, update: false, probe: { chapters: 3 } },
    });
    expect(() => parseGuiaArgs(["--sonda"])).toThrow(/appid/);
    expect(() => parseGuiaArgs(["--appid", "1", "--sonda", "--capitulos", "0"])).toThrow(/capitulos/);
  });

  it("showDraft imprime o último rascunho do pedido agrupado, sem IA nem rede", () => {
    const dir = mkdtempSync(join(tmpdir(), "guias-cli-"));
    const db = openGuideDb(dir);
    saveDraft(db, {
      requestId: "direto-1",
      attempt: 1,
      writingKey: "escrita:a",
      at: new Date("2026-11-03T12:00:00Z"),
      draft: {
        round: 2,
        ok: false,
        probe: false,
        texts: null,
        payload: {} as never,
        problems: [{ text: "O passo cap-1 inventa um chefe.", scope: "cap-1", kind: "checador" }],
        repairs: [],
        internalErrors: [],
      },
    });
    db.close();
    const lines: string[] = [];
    expect(showDraft(dir, "direto-1", (l) => lines.push(l))).toBe(true);
    expect(lines.join("\n")).toContain("rascunho de direto-1, tentativa 1, rodada 2");
    expect(lines).toContain("    - O passo cap-1 inventa um chefe.");
    const none: string[] = [];
    expect(showDraft(dir, "outro", (l) => none.push(l))).toBe(false);
    expect(none[0]).toContain("nenhum rascunho");
  });
});
