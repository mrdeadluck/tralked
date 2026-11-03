import type { GuideReport } from "@/lib/admin/guide-report";

/*
 * The robot report at the end of a walkthrough, for staff only (WalkReportIsland reads it only for
 * them): the sources it read, where they disagree, the facts only one source states, and how much of
 * the Steam list the guide covers.
 */

function Points({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="none">{empty}</p>;
  return (
    <ul>
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  );
}

export function RobotReport({ report, staff }: { report: GuideReport | null; staff: boolean }) {
  if (!staff || !report) return null;
  const { sourcesRead, divergences, singleSource, coverage } = report;
  return (
    <section className="wk-report" aria-labelledby="wk-report-h">
      <header>
        <h2 id="wk-report-h">Relatório do robô</h2>
        <span className="wk-lbl">só a equipe vê · antes de publicar</span>
      </header>
      <div className="b">
        <div>
          <h3 className="wk-lbl">Fontes lidas</h3>
          {sourcesRead.length === 0 ? (
            <p className="none">Nenhuma fonte registrada.</p>
          ) : (
            <ul>
              {sourcesRead.map((s, i) => (
                <li key={i}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      <b>{s.name}</b>
                    </a>
                  ) : (
                    <b>{s.name}</b>
                  )}
                  {s.ok ? null : <span className="no"> · não lida{s.reason ? `: ${s.reason}` : ""}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="wk-lbl">Divergências</h3>
          <Points items={divergences} empty="Nenhuma." />
        </div>
        <div>
          <h3 className="wk-lbl">Fatos com uma fonte só</h3>
          <Points items={singleSource} empty="Nenhum." />
        </div>
        <div>
          <h3 className="wk-lbl">Cobertura</h3>
          {coverage ? (
            <p>
              <b>
                {coverage.covered} de {coverage.steam}
              </b>{" "}
              conquistas da Steam no detonado
              {coverage.steamOnly > 0 ? ` · ${coverage.steamOnly} só existem na Steam` : ""}.
            </p>
          ) : (
            <p className="none">Sem dados de cobertura.</p>
          )}
        </div>
      </div>
    </section>
  );
}
