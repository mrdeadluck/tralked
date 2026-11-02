import Link from "next/link";
import type { ReactNode } from "react";
import { RemoteImg } from "@/components/ui/RemoteImg";
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
/** Events a day of the timeline lists before "Ver mais". */
const PER_DAY = 6;
/** Covers a closed week shows as a preview. */
const WEEK_COVERS = 6;

const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type TimelineWeek = {
  index: number;
  /** Days with events, in order. */
  keys: string[];
  events: CalendarEvent[];
  /** "2–8 nov", or one day "15 nov". */
  range: string;
  covers: string[];
};

/** The month's weeks that have something, for the timeline (one `<details>` each). */
export function timelineWeeks(month: Month, days: Map<string, CalendarEvent[]>): TimelineWeek[] {
  const short = SHORT_MONTHS[month.month - 1];
  return monthWeeks(month).flatMap((week, index) => {
    const inMonth = week.filter((d): d is number => d !== null);
    const keys = inMonth.map((d) => keyOf(month, d)).filter((k) => days.has(k));
    if (keys.length === 0) return [];
    const events = keys.flatMap((k) => days.get(k) ?? []);
    const first = inMonth[0];
    const last = inMonth[inMonth.length - 1];
    // Big releases first: the preview shows what the week is about.
    const covers = [...events]
      .filter((e) => e.kind === "release" && e.imageUrl)
      .sort((a, b) => Number(Boolean(b.big)) - Number(Boolean(a.big)))
      .map((e) => e.imageUrl!)
      .filter((url, i, all) => all.indexOf(url) === i)
      .slice(0, WEEK_COVERS);
    return [{ index, keys, events, range: first === last ? `${first} ${short}` : `${first}–${last} ${short}`, covers }];
  });
}

/** The week open on arrival: today's (or the next one with dates), else the month's first. */
export function weekToOpen(weeks: TimelineWeek[], todayKey: string | null): number | null {
  if (weeks.length === 0) return null;
  if (todayKey) {
    // Keys are "YYYY-MM-DD": string order is date order.
    const upcoming = weeks.find((w) => w.keys[w.keys.length - 1] >= todayKey);
    return (upcoming ?? weeks[weeks.length - 1]).index;
  }
  return weeks[0].index;
}

/** One event of the timeline: the day's lead release with its cover, the rest compact. */
function TimelineEvent({ event: e, lead }: { event: CalendarEvent; lead: boolean }) {
  const cover = lead && e.kind === "release" && e.imageUrl ? e.imageUrl : null;
  const size = e.kind !== "release" ? "font-bold" : e.big ? "text-[17px] font-extrabold" : "text-[14.5px] font-semibold";
  return (
    <li className={`flex min-w-0 gap-2.5 ${cover ? "items-center" : ""}`}>
      {cover ? (
        <RemoteImg
          url={cover}
          alt=""
          width={e.big ? 72 : 52}
          height={e.big ? 96 : 69}
          sizes={e.big ? "72px" : "52px"}
          shape="fit"
          className={`aspect-[3/4] shrink-0 rounded-[2px] border object-cover ${e.big ? "w-[72px] border-acc" : "w-[52px] border-line"}`}
        />
      ) : (
        <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="font-mono text-xs tracking-[0.08em] text-dim uppercase">
          {EVENT_KIND_LABEL[e.kind]}
          {e.big ? <span className="text-acc"> · destaque</span> : null}
        </span>
        {e.href ? (
          // 44 px tall on phones (the title is the tap target), the line height from sm up.
          <Link href={e.href} className={`${size} inline-flex min-h-11 items-center leading-snug hover:text-acc sm:min-h-0`}>
            {e.title}
          </Link>
        ) : (
          <span className={`${size} leading-snug`}>{e.title}</span>
        )}
        {e.detail ? <span className="text-[13.5px] text-muted">{e.detail}</span> : null}
      </span>
    </li>
  );
}

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
  /**
   * Suffix of this instance's element ids: the public month (Suspense fallback) and the visitor's
   * month can both be in the HTML (without JavaScript the second stays hidden), so ids differ.
   */
  idSuffix: string;
};

/**
 * The calendar of one month: a grid (a table of day links, Sunday first) and, below it, the
 * month's timeline, day by day, where each day link of the grid lands. Pure server markup: the
 * month and its prev/next links work without JavaScript; CalendarGridKeys only adds arrow keys.
 */
export function MonthView({ month, todayKey, events, kinds, query = "", subject, idSuffix }: MonthViewProps) {
  const days = byDay(events);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const prevHref = inRange(prev) ? `/calendario/${monthParam(prev)}${query}` : null;
  const nextHref = inRange(next) ? `/calendario/${monthParam(next)}${query}` : null;
  const label = monthLabel(month);
  const todayInMonth = todayKey.startsWith(`${monthParam(month)}-`);
  const startDay = todayInMonth ? Number(todayKey.slice(8, 10)) : 1;
  const timeline = [...days.keys()].sort();
  const weeks = timelineWeeks(month, days);
  const openWeek = weekToOpen(weeks, todayInMonth ? todayKey : null);
  const timelineId = `linha-${monthParam(month)}-${idSuffix}`;
  const hintId = `cal-keys-hint-${idSuffix}`;
  const dayId = (key: string) => `dia-${key}-${idSuffix}`;

  return (
    <div className="flex flex-col gap-8">
      <CalendarGridKeys
        key={monthParam(month)}
        month={monthParam(month)}
        prevMonth={prevHref ? monthParam(prev) : null}
        nextMonth={nextHref ? monthParam(next) : null}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[26px] leading-none font-black font-stretch-[118%] tracking-[-0.02em] first-letter:uppercase">
              {label}
            </h2>
            <nav aria-label="Meses" className="flex items-center gap-1.5 font-mono text-[12px] tracking-[0.06em] uppercase">
              {prevHref ? (
                <Link data-month-nav="prev" href={prevHref} className="inline-flex min-h-11 items-center gap-1.5 border border-line-2 px-3 hover:border-text sm:min-h-9">
                  <span aria-hidden="true">← </span>
                  {monthLabel(prev).split(" de ")[0]}
                  <span className="sr-only"> (mês anterior)</span>
                </Link>
              ) : null}
              <Link href={`/calendario${query}`} className="inline-flex min-h-11 items-center gap-1.5 border border-line-2 px-3 hover:border-text sm:min-h-9">
                Hoje
              </Link>
              {nextHref ? (
                <Link data-month-nav="next" href={nextHref} className="inline-flex min-h-11 items-center gap-1.5 border border-line-2 px-3 hover:border-text sm:min-h-9">
                  {monthLabel(next).split(" de ")[0]}
                  <span className="sr-only"> (próximo mês)</span>
                  <span aria-hidden="true"> →</span>
                </Link>
              ) : null}
            </nav>
          </div>
          {subject ? <div className="text-[14.5px] text-muted">{subject}</div> : null}
          <ul aria-label="Legenda" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 font-mono text-xs text-text-3">
            {kinds.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
                {EVENT_KIND_LABEL[k]}
              </li>
            ))}
          </ul>
          <p id={hintId} className="sr-only">
            Cada dia leva à linha do tempo abaixo. Com o teclado: setas mudam de dia, Page Up e Page Down mudam de mês.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed border-collapse" aria-describedby={hintId}>
              <caption className="sr-only">Calendário de {label}</caption>
              <thead>
                <tr>
                  {WEEKDAYS.map((w) => (
                    <th key={w.short} scope="col" className="pb-2 text-left font-mono text-xs font-normal tracking-[0.08em] text-dim uppercase">
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
                      // The day's biggest release lends its cover to the cell (a big launch, more of it).
                      const lead = list[0]?.kind === "release" && list[0].imageUrl ? list[0] : null;
                      return (
                        <td
                          key={weekday}
                          className={`relative h-[104px] overflow-hidden border border-line align-top ${today ? "bg-surface-2" : ""}`}
                        >
                          {lead ? (
                            <>
                              <RemoteImg
                                url={lead.imageUrl!}
                                alt=""
                                width={240}
                                height={240}
                                sizes="(max-width: 640px) 50vw, 240px"
                                // A portrait cover in a wide cell: uncropped from the CDN, framed on its
                                // upper part (logo and face) instead of a centre strip.
                                shape="fit"
                                style={{ objectPosition: "center 22%" }}
                                className={`absolute inset-0 size-full object-cover ${lead.big ? "opacity-60" : "opacity-30"}`}
                              />
                              {/* Scrim: the day and the titles sit on the cover, so it stays dark under them. */}
                              <span
                                aria-hidden="true"
                                className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,15,.82),rgba(11,12,15,.7)_45%,rgba(11,12,15,.92))]"
                              />
                            </>
                          ) : null}
                          <div className="relative flex h-full flex-col gap-1 p-1.5">
                            <a
                              href={`#${dayId(key)}`}
                              data-day={key}
                              data-weekday={weekday}
                              data-start={day === startDay ? "1" : undefined}
                              aria-label={`${dayLabel(key)}${today ? " (hoje)" : ""}: ${daySummary(list)}`}
                              aria-current={today ? "date" : undefined}
                              // The whole cell is the tap target (::after), the circle marks the day.
                              className={`inline-flex size-7 items-center justify-center rounded-full font-mono text-[12.5px] after:absolute after:inset-0 after:content-[''] ${
                                today ? "bg-acc font-bold text-bg" : list.length > 0 ? "text-text hover:bg-hover" : "text-dim hover:bg-hover"
                              }`}
                            >
                              {day}
                            </a>
                            <ul aria-hidden="true" className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0 [text-shadow:0_1px_2px_rgba(0,0,0,.9)]">
                              {list.slice(0, PER_CELL).map((e, i) => (
                                <li
                                  key={i}
                                  className={`flex min-w-0 items-center gap-1 text-xs leading-tight ${
                                    e.big ? "font-bold text-text" : "text-text-3"
                                  }`}
                                >
                                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                                  <span className="truncate">{e.title}</span>
                                </li>
                              ))}
                              {list.length > PER_CELL ? (
                                <li className="font-mono text-xs text-dim">+{list.length - PER_CELL}</li>
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
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-text pb-3">
          <h2 id={timelineId} className="text-[22px] leading-none font-black font-stretch-[118%] tracking-[-0.02em] uppercase">
            Linha do tempo
          </h2>
          {timeline.length > 0 ? (
            <p className="font-mono text-xs text-muted">Uma semana aberta por vez: toque num dia do calendário para ir até ele.</p>
          ) : null}
        </div>
        {timeline.length === 0 ? (
          <p className="text-[15px] text-muted">Nada marcado em {label}.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {weeks.map((week) => (
              <details
                key={week.index}
                open={week.index === openWeek}
                className="group/week rounded-[4px] border border-line bg-surface open:border-line-2"
              >
                <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-hover [&::-webkit-details-marker]:hidden">
                  <span className="min-w-[112px] font-mono text-xs font-bold tracking-[0.06em] text-text uppercase">{week.range}</span>
                  <span className="min-w-0 flex-1 text-[14px] text-text-3">{daySummary(week.events)}</span>
                  {week.covers.length > 0 ? (
                    <span aria-hidden="true" className="flex -space-x-2 group-open/week:hidden">
                      {week.covers.map((url) => (
                        <RemoteImg
                          key={url}
                          url={url}
                          alt=""
                          width={30}
                          height={40}
                          sizes="30px"
                          shape="fit"
                          className="aspect-[3/4] w-[30px] rounded-[2px] border border-bg object-cover"
                        />
                      ))}
                    </span>
                  ) : null}
                  <span className="font-mono text-xs tracking-[0.08em] text-acc uppercase">
                    <span className="group-open/week:hidden">Ver semana</span>
                    <span className="hidden group-open/week:inline">Fechar</span>
                  </span>
                </summary>
                <ol className="m-0 flex list-none flex-col border-t border-line p-0">
                  {week.keys.map((key) => {
                    const list = days.get(key) ?? [];
                    return (
                      <li
                        key={key}
                        id={dayId(key)}
                        className="grid scroll-mt-24 grid-cols-[120px_minmax(0,1fr)] gap-4 border-b border-divider px-4 py-4 last:border-b-0 target:bg-hover max-sm:grid-cols-1 max-sm:gap-2"
                      >
                        <h3 className="font-mono text-[12px] leading-snug tracking-[0.04em] text-text-3">
                          <time dateTime={key}>{dayLabel(key)}</time>
                          {key === todayKey ? <span className="mt-1 block text-acc uppercase">hoje</span> : null}
                          {key > todayKey ? <span className="mt-1 block text-dim">em breve</span> : null}
                        </h3>
                        <ul className="m-0 flex list-none flex-col gap-2 p-0">
                          {list.slice(0, PER_DAY).map((e, i) => (
                            <TimelineEvent key={i} event={e} lead={i === 0} />
                          ))}
                          {list.length > PER_DAY ? (
                            <li>
                              <details className="group/more">
                                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center font-mono text-xs tracking-[0.08em] text-acc uppercase hover:underline [&::-webkit-details-marker]:hidden">
                                  <span className="group-open/more:hidden">Ver mais {list.length - PER_DAY} neste dia</span>
                                  <span className="hidden group-open/more:inline">Ver menos</span>
                                </summary>
                                <ul className="m-0 flex list-none flex-col gap-2 p-0 pt-1">
                                  {list.slice(PER_DAY).map((e, i) => (
                                    <TimelineEvent key={i} event={e} lead={false} />
                                  ))}
                                </ul>
                              </details>
                            </li>
                          ) : null}
                        </ul>
                      </li>
                    );
                  })}
                </ol>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
