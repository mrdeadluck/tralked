import { describe, expect, it } from "vitest";
import { describePending, parseReport, reportSummary } from "./guide-report";

describe("parseReport", () => {
  const base = {
    sourcesRead: [{ name: "PowerPyx", url: "https://www.powerpyx.com/", ok: true }],
    divergences: [],
    singleSource: [],
    coverage: { steam: 66, covered: 36, steamOnly: 30 },
    spendUsd: 2.5,
  };

  it("reads the scope, the PSN coverage and the robot's internal errors", () => {
    const report = parseReport({
      ...base,
      scope: "psn",
      psnCoverage: { total: 36, covered: 36 },
      internalErrors: ["capítulo 3 antes do 2"],
    });
    expect(report).toMatchObject({ psnScope: { total: 36, covered: 36 }, internalErrors: ["capítulo 3 antes do 2"] });
    expect(reportSummary(report)).toContain("lista da PSN 36/36");
    expect(reportSummary(report)).toContain("1 erro interno");
  });

  it("reads the PlayStation list's size when the robot sent it, and only then", () => {
    expect(parseReport({ ...base, coverage: { ...base.coverage, psn: 36 } })?.coverage).toEqual({ steam: 66, covered: 36, steamOnly: 30, psn: 36 });
    expect(parseReport(base)?.coverage).not.toHaveProperty("psn");
    expect(parseReport({ ...base, coverage: { ...base.coverage, psn: "36" } })?.coverage).not.toHaveProperty("psn");
  });

  it("a guide by the Steam list, or an older report, reads exactly as before (the robot's contract tests compare it)", () => {
    const keys = ["coverage", "divergences", "singleSource", "sourcesRead", "spendUsd"];
    expect(Object.keys(parseReport(base)!).sort()).toEqual(keys);
    expect(Object.keys(parseReport({ ...base, scope: "steam", internalErrors: [] })!).sort()).toEqual(keys);
    expect(parseReport({ ...base, scope: "psn", psnCoverage: { total: "x" } })?.psnScope).toEqual({ total: null, covered: null });
    expect(reportSummary(parseReport({ ...base, scope: "psn" }))).toContain("pela lista da PSN");
    expect(reportSummary(parseReport(base))).not.toContain("PSN");
  });
});

describe("R44: pendências do checador", () => {
  const base = { sourcesRead: [], divergences: [], singleSource: [], coverage: { steam: 66, covered: 66, steamOnly: 31 }, spendUsd: 50 };
  const pendencias = [
    { scope: "conq-ach-032", texto: "Mirage Estate não está no dossiê." },
    { scope: "frame", texto: "A capa exagera." },
  ];

  it("lê as pendências, conta no resumo e ignora entradas sem texto", () => {
    const report = parseReport({ ...base, pendencias: [...pendencias, { scope: "x" }, "lixo"] });
    expect(report?.pendencias).toEqual(pendencias);
    expect(reportSummary(report)).toContain("2 pendências do checador");
    expect(parseReport(base)).not.toHaveProperty("pendencias");
  });

  it("uma atualização pendente enviada com pendências diz quais antes de aplicar", () => {
    const lines = describePending(null, { report: { ...base, pendencias } });
    expect(lines).toContain(
      "Pendências do checador (leia antes de aplicar): [conq-ach-032] Mirage Estate não está no dossiê. | [frame] A capa exagera.",
    );
    expect(describePending(null, { report: base }).join(" ")).not.toContain("Pendências");
  });
});
