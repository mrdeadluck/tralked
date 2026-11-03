export type Bar = {
  label: string;
  value: number;
  /** Text shown for the value ("1.234 h"). */
  display: string;
  /** Mark color (a token, e.g. "var(--ps)"); the accent by default. */
  color?: string;
};

/**
 * A labelled horizontal bar list (one series, one hue: dim lime, the largest value in lime): every
 * value is written next to its bar, so the bar is only a visual aid (hidden from assistive tech)
 * and the list reads as a table. `color` marks the label with a small square, never the bar.
 */
export function BarList({ title, bars, empty }: { title: string; bars: Bar[]; empty: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  return (
    <section className="relative bg-surface p-[18px] tk-cut before:absolute before:top-0 before:right-[10px] before:left-0 before:h-[2px] before:bg-line-2 before:content-['']">
      <h3 className="text-[17px] leading-tight font-extrabold font-stretch-[80%] tracking-[0.06em] uppercase">{title}</h3>
      {bars.length === 0 || max === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <dl className="m-0 mt-3.5 flex flex-col gap-2.5">
          {bars.map((bar) => (
            <div key={bar.label} className="grid grid-cols-[minmax(96px,130px)_minmax(0,1fr)] items-center gap-3">
              <dt className="flex items-center gap-2 truncate text-sm text-text-2">
                {bar.color ? <span aria-hidden="true" className="size-1.5 flex-none" style={{ background: bar.color }} /> : null}
                {bar.label}
              </dt>
              <dd className="m-0 grid grid-cols-[minmax(0,1fr)_74px] items-center gap-3">
                <span aria-hidden="true" className="h-3.5 overflow-hidden bg-track">
                  <i
                    className={`block h-full ${bar.value === max ? "bg-acc" : "bg-acc-dim"}`}
                    style={{ width: `${Math.max(bar.value > 0 ? 2 : 0, (bar.value / max) * 100)}%` }}
                  />
                </span>
                <span className="text-right text-sm font-extrabold text-text tabular-nums">{bar.display}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
