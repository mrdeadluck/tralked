import { RECURRING, type Recurring } from "./ai/triage.js";
import { localDay } from "./clock.js";

/**
 * Recurring announcements (PS Plus, Game Pass, Epic free game) are covered once each (spec "Itens
 * recorrentes": "a chave para não repetir é o anúncio, não o mês"). An announcement is known by its kind
 * and the São Paulo day its story started: `ps-plus:2026-11-25`. Two stories of one kind started at most
 * `RECURRING_WINDOW_DAYS` apart are the same announcement (sites repeat it for a few days); distinct
 * announcements of one kind are a week or more apart: PS Plus Extra (2nd Wednesday) and Essential (last
 * Wednesday), the two Game Pass waves, the weekly Epic free game.
 */
export const RECURRING_WINDOW_DAYS = 6;

export function recurringKey(kind: Recurring, day: Date): string {
  return `${kind}:${localDay(day)}`;
}

const parse = (key: string): { kind: string; day: number } | null => {
  const m = /^([a-z-]+):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m || !(RECURRING as readonly string[]).includes(m[1]!)) return null;
  const day = Date.parse(`${m[2]}T12:00:00Z`);
  return Number.isNaN(day) ? null : { kind: m[1]!, day };
};

/** The kind of a recurring key ("ps-plus"), or null for a malformed one. */
export const recurringKind = (key: string): string | null => parse(key)?.kind ?? null;

/** Whether two recurring keys are the same announcement (same kind, at most the window apart). */
export function sameAnnouncement(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  return !!x && !!y && x.kind === y.kind && Math.abs(x.day - y.day) <= RECURRING_WINDOW_DAYS * 86_400_000;
}
