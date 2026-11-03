import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseReport } from "@/lib/admin/guide-report";
import { GuideReportPanel } from "./GuideReportPanel";

afterEach(cleanup);

const base = { sourcesRead: [], divergences: [], singleSource: [], coverage: { steam: 66, covered: 66, steamOnly: 31 }, spendUsd: 50 };

describe("GuideReportPanel: pendências do checador (R44)", () => {
  it("mostra as pendências, com o trecho, antes do resto", () => {
    const report = parseReport({ ...base, pendencias: [{ scope: "conq-ach-032", texto: "Mirage Estate não está no dossiê." }] })!;
    render(<GuideReportPanel report={report} />);
    expect(screen.getByRole("heading", { name: "Pendências do checador" })).toBeInTheDocument();
    expect(screen.getByText("Mirage Estate não está no dossiê.")).toBeInTheDocument();
    expect(screen.getByText(/\[conq-ach-032\]/)).toBeInTheDocument();
    expect(screen.getByText(/leia antes de aprovar/)).toBeInTheDocument();
  });

  it("sem pendências, nada aparece", () => {
    render(<GuideReportPanel report={parseReport(base)!} />);
    expect(screen.queryByText("Pendências do checador")).not.toBeInTheDocument();
  });
});
