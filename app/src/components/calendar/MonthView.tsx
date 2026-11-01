import Link from "next/link";
import type { ReactNode } from "react";
import { byDay, EVENT_KIND_LABEL, type CalendarEvent, type CalendarEventKind } from "@/lib/calendar/events";
import {
  addMonths,
  dayLabel,
  inRange,
  keyOf,
  monthLabel,
  monthParam,
  monthWeeks,
  WEEKDAYS,
  type Month,
} from "@/lib/calendar/month";
import { CalendarGridKeys } from "./CalendarGridKeys";

export const KIND_COLOR: Record<CalendarEventKind, string> = {
  release: "var(--acc)",
  article: "var(--text-2)",
  mission: "var(--brand-2)",
  playtime: "var(--pc)",
  unlock: "var(--r-raro)",
};

const KIND_PLURAL: Record<CalendarEventKind, [string, string]> = {
  release: ["lançamento", "lançamentos"],
  article: ["matéria", "matérias"],
  mission: ["missão", "missões"],
  playtime: ["marco de horas", "marcos de horas"],
  unlock: ["jogo com conquistas", "jogos com conquistas"],
};

/** "2 lançamentos, 1 matéria" for a day's events (the day link's accessible name). */
export function daySummary(events: CalendarEvent[]): string {
  const counts = new Map<CalendarEventKind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  if (counts.size === 0) return "nada marcado";
  return [...counts].map(([kind, n]) => `${n} ${KIND_PLURAL[kind][n === 1 ? 0 : 1]}`).join(", ");
}

const PER_CELL = 3;

export type MonthViewProps = {
  month: Month;
  todayKey: string;
  events: CalendarEvent[];
  /** Kinds present in this view (the legend); personal kinds only when a player is shown. */
  kinds: CalendarEventKind[];
  /** Appended to month links (e.g. `?jogador=handle`). */
  query?: string;
  /** Line about whose achievements are shown (or why none are). */
  subject?: ReactNode;
};

/**
 * The calendar of one month: a grid (a table of day links, Sunday first) and, below it, the
 * month's timeline, day by day, where each day link of the grid lands. Pure server markup: the
 * month and its prev/next links work without JavaScript; CalendarGridKeys only adds arrow keys.
 */
export function MonthView({ month, todayKey, events, kinds, query = "", subject }: MonthViewProps) {
  const days = byDay(events);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const prevHref = inRange(prev) ? `/calendario/${monthParam(prev)}${query}` : null;
  const nextHref = inRange(next) ? `/calendario/${monthParam(next)}${query}` : null;
  const label = monthLabel(month);
  const todayInMonth = todayKey.startsWith(`${monthParam(month)}-`);
  const startDay = todayInMonth ? Number(todayKey.slice(8, 10)) : 1;
  const timeline = [...days.keys()].sort();
  const timelineId = `linha-${monthParam(month)}`;

  return (
    <div className="flex flex-col gap-8">
      <CalendarGridKeys prevHref={prevHref} nextHref={nextHref}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[26px] leading-none font-black font-stretch-[118%] tracking-[-0.02em] first-letter:uppercase">
              {label}
            </h2>
            <nav aria-label="Meses" className="flex items-center gap-1.5 font-mono text-[12px] tracking-[0.06em] uppercase">
              {prevHref ? (
                <Link data-month-nav="prev" href={prevHref} className="border border-line-2 px-3 py-1.5 hover:border-text">
                  <span aria-hidden="true">← </span>
                  {monthLabel(prev).split(" de ")[0]}
                  <span className="sr-only"> (mês anterior)</span>
                </Link>
              ) : null}
              <Link href={`/calendario${query}`} className="border border-line-2 px-3 py-1.5 hover:border-text">
                Hoje
              </Link>
              {nextHref ? (
                <Link data-month-nav="next" href={nextHref} className="border border-line-2 px-3 py-1.5 hover:border-text">
                  {monthLabel(next).split(" de ")[0]}
                  <span className="sr-only"> (próximo mês)</span>
                  <span aria-hidden="true"> →</span>
                </Link>
              ) : null}
            </nav>
          </div>
          {subject ? <div className="text-[14.5px] text-muted">{subject}</div> : null}
          <ul aria-label="Legenda" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 font-mono text-[11px] text-text-3">
            {kinds.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
                {EVENT_KIND_LABEL[k]}
              </li>
            ))}
          </ul>
          <p id="cal-keys-hint" className="sr-only">
            Cada dia leva à linha do tempo abaixo. Com o teclado: setas mudam de dia, Page Up e Page Down mudam de mês.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed border-collapse" aria-describedby="cal-keys-hint">
              <caption className="sr-only">Calendário de {label}</caption>
              <thead>
                <tr>
                  {WEEKDAYS.map((w) => (
                    <th key={w.short} scope="col" className="pb-2 text-left font-mono text-[11px] font-normal tracking-[0.08em] text-dim uppercase">
                      <abbr title={w.long} className="no-underline">
                        {w.short}
                      </abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthWeeks(month).map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, weekday) => {
                      if (day === null) return <td key={weekday} className="border border-line bg-bg-deep" />;
                      const key = keyOf(month, day);
                      const list = days.get(key) ?? [];
                      const today = key === todayKey;
                      return (
                        <td key={weekday} className={`h-[104px] border border-line align-top ${today ? "bg-surface-2" : ""}`}>
                          <div className="flex h-full flex-col gap-1 p-1.5">
                            <a
                              href={`#dia-${key}`}
                              data-day={key}
                              data-weekday={weekday}
                              data-start={day === startDay ? "1" : undefined}
                              aria-label={`${dayLabel(key)}${today ? " (hoje)" : ""}: ${daySummary(list)}`}
                              aria-current={today ? "date" : undefined}
                              className={`inline-flex size-7 items-center justify-center rounded-full font-mono text-[12.5px] ${
                                today ? "bg-acc font-bold text-bg" : list.length > 0 ? "text-text hover:bg-hover" : "text-dim hover:bg-hover"
                              }`}
                            >
                              {day}
                            </a>
                            <ul aria-hidden="true" className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">
                              {list.slice(0, PER_CELL).map((e, i) => (
                                <li key={i} className="flex min-w-0 items-center gap-1 text-[11.5px] leading-tight text-text-3">
                                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                                  <span className="truncate">{e.title}</span>
                                </li>
                              ))}
                              {list.length > PER_CELL ? (
                                <li className="font-mono text-[10.5px] text-dim">+{list.length - PER_CELL}</li>
                              ) : null}
                            </ul>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CalendarGridKeys>

      <section aria-labelledby={timelineId} className="flex flex-col gap-4">
        <h2 id={timelineId} className="border-b-2 border-text pb-3 text-[22px] leading-none font-black font-stretch-[118%] tracking-[-0.02em] uppercase">
          Linha do tempo
        </h2>
        {timeline.length === 0 ? (
          <p className="text-[15px] text-muted">Nada marcado em {label}.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {timeline.map((key) => {
              return (
                <li key={key} id={`dia-${key}`} className="grid scroll-mt-24 grid-cols-[120px_minmax(0,1fr)] gap-4 border-b border-divider py-4 max-sm:grid-cols-1 max-sm:gap-2">
                  <h3 className="font-mono text-[12px] leading-snug tracking-[0.04em] text-text-3">
                    <time dateTime={key}>{dayLabel(key)}</time>
                    {key === todayKey ? <span className="mt-1 block text-acc uppercase">hoje</span> : null}
                    {key > todayKey ? <span className="mt-1 block text-dim">em breve</span> : null}
                  </h3>
                  <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {(days.get(key) ?? []).map((e, i) => (
                      <li key={i} className="flex min-w-0 gap-2.5">
                        <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-mono text-[10.5px] tracking-[0.08em] text-dim uppercase">{EVENT_KIND_LABEL[e.kind]}</span>
                          {e.href ? (
                            <Link href={e.href} className="font-bold leading-snug hover:text-acc">
                              {e.title}
                            </Link>
                          ) : (
                            <span className="font-bold leading-snug">{e.title}</span>
                          )}
                          {e.detail ? <span className="text-[13.5px] text-muted">{e.detail}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
