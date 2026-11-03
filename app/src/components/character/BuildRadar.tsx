import type { ReactNode, SVGProps } from "react";
import { Bar, Panel } from "./Panel";
import { Radar, radarMax } from "./Radar";
import { RadarHover } from "./RadarHover";

export type BuildRow = {
  id: string;
  name: string;
  /** The level. */
  value: number;
  /** Progress inside the level (0..1). */
  fraction: number;
  /** Under the bar, left and right ("vem de horas jogadas", "120 pts · faltam 30"). */
  left: string;
  right?: string;
  /** Long explanation of the row (tooltip and screen readers). */
  description?: string;
};

type BuildRadarProps = {
  title: string;
  aside: ReactNode;
  rows: BuildRow[];
  topId: string | null;
  /** Accessible name of the chart. */
  chartLabel: string;
  icon: (id: string, props: SVGProps<SVGSVGElement>) => ReactNode;
  /** Line under the list (strongest, weakest…). */
  legend?: ReactNode;
};

/**
 * A "build" panel of the sheet: the radar of every row on the left, the full list in two columns
 * on the right (icon tile, name, level, bar, where it comes from and what is left). Pointing at a
 * row or at a tip lights both.
 */
export function BuildRadar({ title, aside, rows, topId, chartLabel, icon, legend }: BuildRadarProps) {
  return (
    <Panel title={title} aside={aside} accent>
      <RadarHover className="grid items-center gap-[22px] min-[1101px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Radar
          points={rows.map((r) => ({ id: r.id, name: r.name, value: r.value }))}
          max={radarMax(rows.map((r) => r.value))}
          topId={topId}
          label={chartLabel}
          valueLabel="Nível"
          renderIcon={icon}
          className="mx-auto w-full max-w-[380px] px-2"
        />
        <div className="min-w-0">
          <ul className="m-0 grid list-none gap-0.5 p-0 min-[761px]:grid-cols-2">
            {rows.map((row) => {
              const isTop = row.id === topId;
              const percent = Math.floor(Math.min(1, row.fraction) * 100);
              return (
                <li
                  key={row.id}
                  data-k={row.id}
                  title={row.description}
                  className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 bg-surface-2 py-2 pr-2.5 pl-2 transition-colors duration-150 hover:bg-hover-2 [&.hl]:bg-hover-2"
                >
                  <span
                    className={`grid size-[34px] place-items-center tk-cut-sm ${isTop ? "bg-moss text-acc" : "bg-track text-text-2"}`}
                  >
                    {icon(row.id, { className: "size-[22px]" })}
                  </span>
                  <strong className="truncate text-[14.5px] font-bold">{row.name}</strong>
                  <span
                    className={`text-xl leading-none font-black font-stretch-[112%] tabular-nums ${isTop ? "text-acc" : ""}`}
                  >
                    <span className="sr-only">Nível </span>
                    {row.value}
                  </span>
                  <div className="col-start-2 col-end-4 flex flex-col gap-1">
                    <span
                      role="progressbar"
                      aria-label={`Progresso de ${row.name} para o nível ${row.value + 1}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <Bar fraction={row.fraction} hot={isTop} className="h-1" />
                    </span>
                    <small className="flex flex-wrap justify-between gap-x-2 text-xs text-muted">
                      <span>{row.left}</span>
                      {row.right ? <span className="tabular-nums">{row.right}</span> : null}
                    </small>
                    {row.description ? <span className="sr-only">{row.description}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {legend ? <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-muted">{legend}</p> : null}
        </div>
      </RadarHover>
    </Panel>
  );
}
