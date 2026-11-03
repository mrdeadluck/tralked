import type { GuideReport } from "@/lib/admin/guide-report";
import { reportSummary } from "@/lib/admin/guide-report";
import { AdminSection } from "./ui";

const LIST = "m-0 flex list-disc flex-col gap-1 pl-5 text-[14px]";

/** The robot's report of a guide, for the editor (sources read, divergences, single-source facts, coverage). */
export function GuideReportPanel({ report }: { report: GuideReport }) {
  return (
    <AdminSection title="Relatório do robô" aside={reportSummary(report)}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-xs tracking-[0.08em] text-dim uppercase">Fontes lidas</h3>
          {report.sourcesRead.length === 0 ? (
            <p className="text-[14px] text-muted">Nenhuma fonte registrada.</p>
          ) : (
            <ul className={LIST}>
              {report.sourcesRead.map((s) => (
                <li key={`${s.name}-${s.url}`}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-acc underline underline-offset-4 hover:no-underline">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                  {s.ok ? "" : ` — não lida${s.reason ? `: ${s.reason}` : ""}`}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-xs tracking-[0.08em] text-dim uppercase">Cobertura</h3>
          {report.coverage ? (
            <p className="text-[14px]">
              {report.coverage.covered} de {report.coverage.steam} conquistas da Steam cobertas
              {report.coverage.steamOnly > 0 ? `; ${report.coverage.steamOnly} só na Steam, sem fonte nativa` : ""}.
              {report.spendUsd !== null ? ` Gasto de IA: US$ ${report.spendUsd.toFixed(2)}.` : ""}
            </p>
          ) : (
            <p className="text-[14px] text-muted">O robô não informou a cobertura.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-xs tracking-[0.08em] text-dim uppercase">Divergências entre fontes</h3>
          {report.divergences.length === 0 ? (
            <p className="text-[14px] text-muted">Nenhuma.</p>
          ) : (
            <ul className={LIST}>
              {report.divergences.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-xs tracking-[0.08em] text-dim uppercase">Fatos com uma fonte só</h3>
          {report.singleSource.length === 0 ? (
            <p className="text-[14px] text-muted">Nenhum.</p>
          ) : (
            <ul className={LIST}>
              {report.singleSource.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminSection>
  );
}
