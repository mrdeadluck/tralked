"use client";

import { useState } from "react";

type YearRow = { year: number; count: number };

const nf = (n: number) => n.toLocaleString("pt-BR");

/**
 * Achievements per year as columns of one hue (the peak year in lime). Hovering or focusing a
 * column shows its number; every year is also in a visually hidden table. Years without unlocks
 * between the first and the last one are drawn as empty columns.
 */
export function YearChart({ rows }: { rows: YearRow[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (rows.length === 0) return <p className="text-sm text-muted">Nenhuma conquista ainda.</p>;
  const byYear = new Map(rows.map((r) => [r.year, r.count]));
  const first = rows[0].year;
  const last = rows[rows.length - 1].year;
  const years = Array.from({ length: last - first + 1 }, (_, i) => ({ year: first + i, count: byYear.get(first + i) ?? 0 }));
  const max = Math.max(1, ...years.map((y) => y.count));
  const peak = years.reduce((best, y) => (y.count > best.count ? y : best), years[0]);

  return (
    <div>
      <div
        role="group"
        aria-label={`Conquistas por ano, de ${first} a ${last}; pico em ${peak.year} com ${nf(peak.count)}`}
        className="grid h-[236px] auto-cols-[minmax(0,56px)] grid-flow-col items-end justify-center gap-[3px] border-b border-line-2 bg-[repeating-linear-gradient(0deg,transparent_0_49px,var(--border)_49px_50px)] pt-9"
      >
        {years.map((y) => (
          <button
            key={y.year}
            type="button"
            aria-label={`${y.year}: ${nf(y.count)} ${y.count === 1 ? "conquista" : "conquistas"}`}
            onMouseEnter={() => setActive(y.year)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(y.year)}
            onBlur={() => setActive(null)}
            className="group relative flex h-full cursor-default items-end"
          >
            <i
              className={`block min-h-0.5 w-full transition-colors duration-150 group-hover:bg-acc group-focus-visible:bg-acc ${
                y.year === peak.year ? "bg-acc" : "bg-acc-dim"
              }`}
              style={{ height: `${(y.count / max) * 100}%` }}
            />
            {active === y.year ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 bg-hover-2 px-2.5 py-1.5 text-[13px] font-normal whitespace-nowrap text-text shadow-[0_6px_16px_rgba(0,0,0,.5)]"
                style={{ bottom: `calc(${Math.min(100, (y.count / max) * 100)}% + 6px)` }}
              >
                {y.year} · <b className="font-extrabold">{nf(y.count)}</b> {y.count === 1 ? "conquista" : "conquistas"}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 grid auto-cols-[minmax(0,56px)] justify-center grid-flow-col gap-[3px] text-center text-[11px] text-muted tabular-nums">
        {years.map((y) => (
          <span key={y.year}>{String(y.year).slice(2)}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Conquistas por ano</caption>
        <tbody>
          {years.map((y) => (
            <tr key={y.year}>
              <th scope="row">{y.year}</th>
              <td>{nf(y.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
