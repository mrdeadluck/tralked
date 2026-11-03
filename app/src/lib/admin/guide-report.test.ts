import { describe, expect, it } from "vitest";
import { parseReport, reportSummary } from "./guide-report";

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

  it("a guide by the Steam list, or an older report, reads exactly as before (the robot's contract tests compare it)", () => {
    const keys = ["coverage", "divergences", "singleSource", "sourcesRead", "spendUsd"];
    expect(Object.keys(parseReport(base)!).sort()).toEqual(keys);
    expect(Object.keys(parseReport({ ...base, scope: "steam", internalErrors: [] })!).sort()).toEqual(keys);
    expect(parseReport({ ...base, scope: "psn", psnCoverage: { total: "x" } })?.psnScope).toEqual({ total: null, covered: null });
    expect(reportSummary(parseReport({ ...base, scope: "psn" }))).toContain("pela lista da PSN");
    expect(reportSummary(parseReport(base))).not.toContain("PSN");
  });
});
