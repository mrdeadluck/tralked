import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { localDay } from "./clock.js";
import type { Config, Source } from "./config.js";
import type { AlertRow, Db } from "./db.js";

/**
 * Alerts: every alert the robot raises goes through `alert()`, which stores a row (for the e-mail and the
 * daily summary) and appends a line to `data/logs/YYYY-MM-DD.log`. `sendPendingAlerts` e-mails the unsent
 * ones through Resend, and runs at the end of every command.
 */

export type AlertKind = "checagem" | "orcamento" | "pausado" | "fonte" | "api" | "recusa";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const HOUR_MS = 60 * 60 * 1000;
/** A source with no success for longer than this raises a `fonte` alert. */
export const SOURCE_SILENCE_MS = 24 * HOUR_MS;

const RESEND_URL = "https://api.resend.com/emails";
const EMAIL_FROM = "no-reply@tralked.com";
const TZ = "America/Sao_Paulo";

const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "31/10/2026 10:05", São Paulo time. */
export function formatLocal(d: Date): string {
  return timeFmt.format(d).replace(",", "");
}

/** Appends a line to today's log file (São Paulo day). No-op for an in-memory database. */
export function logLine(db: Db, line: string, now: Date = new Date()): void {
  if (db.dir === ":memory:") return;
  try {
    const logs = join(db.dir, "logs");
    mkdirSync(logs, { recursive: true });
    appendFileSync(join(logs, `${localDay(now)}.log`), `${now.toISOString()} ${line}\n`);
  } catch {
    // A full disk or a locked log must never take the robot down.
  }
}

/** Stores an alert and logs it. */
export function alert(db: Db, kind: AlertKind, message: string, now: Date = new Date()): void {
  db.addAlert(kind, message, now);
  logLine(db, `[alerta:${kind}] ${message}`, now);
}

/**
 * Raises the alert unless one of the same kind whose message starts with `prefix` (default: the whole
 * message) was already raised on the same local day. Returns true when raised.
 */
export function alertOncePerDay(
  db: Db,
  kind: AlertKind,
  message: string,
  now: Date = new Date(),
  prefix: string = message,
): boolean {
  const today = localDay(now);
  const seen = db.alerts().some((a) => a.kind === kind && a.message.startsWith(prefix) && localDay(new Date(a.at)) === today);
  if (seen) return false;
  alert(db, kind, message, now);
  return true;
}

/**
 * Since when a source has been without success: its last success, or, when it never had one, the first time
 * it was checked (recorded with `record`). Undefined for a source that was never checked.
 */
function silentSince(db: Db, source: Source, now: Date, record: boolean): number | undefined {
  const lastOk = db.sourceHealth(source.id)?.last_ok_at;
  if (lastOk) return Date.parse(lastOk);
  const key = `source_since:${source.id}`;
  const stored = db.getMeta(key);
  if (stored !== undefined) return Date.parse(stored);
  if (!record) return undefined;
  db.setMeta(key, now.toISOString());
  return now.getTime();
}

export type BrokenSource = { id: string; name: string; silentHours: number; lastError: string | null };

/** Active sources with no success for more than 24 h as of `now` (read-only). */
export function brokenSources(db: Db, sources: Source[], now: Date = new Date()): BrokenSource[] {
  const broken: BrokenSource[] = [];
  for (const source of sources) {
    if (!source.active) continue;
    const since = silentSince(db, source, now, false);
    if (since === undefined || now.getTime() - since <= SOURCE_SILENCE_MS) continue;
    broken.push({
      id: source.id,
      name: source.name,
      silentHours: Math.floor((now.getTime() - since) / HOUR_MS),
      lastError: db.sourceHealth(source.id)?.last_error ?? null,
    });
  }
  return broken;
}

/**
 * Raises a `fonte` alert for every active source with no success for more than 24 h, at most once a day per
 * source. A source that never succeeded counts from the first time it was checked. Returns the alerts raised.
 */
export function checkSourceHealth(db: Db, sources: Source[], now: Date = new Date()): number {
  let raised = 0;
  for (const source of sources) {
    if (!source.active) continue;
    const health = db.sourceHealth(source.id);
    const since = silentSince(db, source, now, true)!;
    const silentMs = now.getTime() - since;
    if (silentMs <= SOURCE_SILENCE_MS) continue;

    const hours = Math.floor(silentMs / HOUR_MS);
    const label = `Fonte "${source.name}" (${source.id}) `;
    const detail = health?.last_error ? ` Último erro: ${health.last_error}.` : "";
    const lastOk = health?.last_ok_at ? ` (último sucesso: ${formatLocal(new Date(health.last_ok_at))})` : " (nunca teve sucesso)";
    if (alertOncePerDay(db, "fonte", `${label}sem sucesso há ${hours} h${lastOk}.${detail}`, now, label)) raised++;
  }
  return raised;
}

/** Sends a plain-text e-mail through Resend; false when it is not configured or the request failed. */
export async function sendEmail(
  config: Pick<Config, "RESEND_API_KEY" | "ALERT_EMAIL">,
  fetchFn: FetchLike,
  subject: string,
  text: string,
): Promise<boolean> {
  if (!config.RESEND_API_KEY || !config.ALERT_EMAIL) return false;
  try {
    const response = await fetchFn(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [config.ALERT_EMAIL], subject, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function alertsEmail(rows: AlertRow[]): { subject: string; text: string } {
  const n = rows.length;
  const subject = `Tralked Robô: ${n} ${n === 1 ? "alerta" : "alertas"}`;
  const lines = rows.map((a) => `[${formatLocal(new Date(a.at))}] ${a.kind}: ${a.message}`);
  const text = [`O robô de notícias registrou ${n} ${n === 1 ? "alerta" : "alertas"}:`, "", ...lines, "", "Horários de Brasília."].join("\n");
  return { subject, text };
}

/**
 * E-mails every unsent alert in one message, then marks them `emailed`. Does nothing without `RESEND_API_KEY`
 * and `ALERT_EMAIL`. Never throws: when Resend fails the alerts stay pending for the next command. Rows are
 * claimed before the request, so two commands finishing together do not send the same alert twice.
 */
export async function sendPendingAlerts(
  db: Db,
  config: Pick<Config, "RESEND_API_KEY" | "ALERT_EMAIL">,
  fetchFn: FetchLike,
  now: Date = new Date(),
): Promise<number> {
  if (!config.RESEND_API_KEY || !config.ALERT_EMAIL) return 0;
  try {
    const claim = db.raw.prepare("UPDATE alerts SET emailed = 1 WHERE id = ? AND emailed = 0");
    const release = db.raw.prepare("UPDATE alerts SET emailed = 0 WHERE id = ?");
    const pending = db.alerts().filter((a) => a.emailed === 0);
    const claimed = pending.filter((a) => Number(claim.run(a.id).changes) === 1);
    if (claimed.length === 0) return 0;

    const { subject, text } = alertsEmail(claimed);
    const sent = await sendEmail(config, fetchFn, subject, text);
    if (!sent) {
      for (const a of claimed) release.run(a.id);
      logLine(db, `[email] falha ao enviar ${claimed.length} alerta(s); ficam pendentes`, now);
      return 0;
    }
    return claimed.length;
  } catch (error) {
    logLine(db, `[email] erro ao enviar alertas: ${error instanceof Error ? error.message : String(error)}`, now);
    return 0;
  }
}
