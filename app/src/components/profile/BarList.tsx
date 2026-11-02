export type Bar = {
  label: string;
  value: number;
  /** Text shown for the value ("1.234 h"). */
  display: string;
  /** Mark color (a token, e.g. "var(--ps)"); the accent by default. */
  color?: string;
};

/**
 * A labelled horizontal bar list (one series): every value is written next to its bar, so the bar
 * is only a visual aid (hidden from assistive tech) and the list reads as a table.
 */
export function BarList({ title, bars, empty }: { title: string; bars: Bar[]; empty: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  return (
    <section className="rounded-[4px] border border-line bg-surface p-5">
      <h3 className="font-mono text-xs tracking-[0.12em] text-dim-2 uppercase">{title}</h3>
      {bars.length === 0 || max === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <dl className="m-0 mt-3.5 flex flex-col gap-2.5">
          {bars.map((bar) => (
            <div key={bar.label} className="grid grid-cols-[minmax(90px,140px)_minmax(0,1fr)] items-center gap-3">
              <dt className="truncate text-sm text-text-2">{bar.label}</dt>
              <dd className="m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-[2px] bg-track">
                  <i
                    className="block h-full rounded-r-[4px]"
                    style={{
                      width: `${Math.max(bar.value > 0 ? 2 : 0, (bar.value / max) * 100)}%`,
                      background: bar.color ?? "var(--acc)",
                    }}
                  />
                </span>
                <span className="text-right font-mono text-[12px] text-text tabular-nums">{bar.display}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
