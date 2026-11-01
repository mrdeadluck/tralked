const TZ = "America/Sao_Paulo";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const o: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(d)) {
    if (p.type !== "literal") o[p.type] = Number(p.value);
  }
  return { y: o.year!, mo: o.month!, d: o.day!, h: o.hour!, mi: o.minute!, s: o.second! };
}

/** Local calendar day in America/Sao_Paulo, "YYYY-MM-DD". */
export function localDay(d: Date): string {
  const p = parts(d);
  return `${String(p.y).padStart(4, "0")}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Local hour 0-23 in America/Sao_Paulo. */
export function localHour(d: Date): number {
  return parts(d).h;
}

/** True when the local hour is within [first, last] inclusive. */
export function inSlotWindow(d: Date, first = 6, last = 23): boolean {
  const h = localHour(d);
  return h >= first && h <= last;
}

/** Instant for a local wall-clock time (America/Sao_Paulo) on the given "YYYY-MM-DD" day. */
function localToDate(day: string, hour: number, minute: number): Date {
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, hour, minute);
  // Find the offset by formatting a first guess and correcting by the observed difference.
  let guess = new Date(wall);
  for (let i = 0; i < 2; i++) {
    const p = parts(guess);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess = new Date(guess.getTime() + (wall - seen));
  }
  return guess;
}

/** The instant local midnight (00:00 America/Sao_Paulo) starts the "YYYY-MM-DD" day. */
export function localStartOfDay(day: string): Date {
  return localToDate(day, 0, 0);
}

/** Uniform random minute within 06:00-23:59 local on `day`. */
export function randomTimeOn(day: string, rand: () => number = Math.random): Date {
  const first = 6 * 60;
  const total = 24 * 60 - first; // 06:00..23:59 inclusive = 1080 minutes
  const offset = Math.min(total - 1, Math.floor(rand() * total));
  const minuteOfDay = first + offset;
  return localToDate(day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
}
