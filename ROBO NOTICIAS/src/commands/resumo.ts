import { parseArgs } from "node:util";
import { brokenSources, sendEmail, sendPendingAlerts, type BrokenSource } from "../alerts.js";
import { localDay } from "../clock.js";
import type { Source } from "../config.js";
import type { Db } from "../db.js";
import { runIfMain } from "./run.js";

export type Resumo = {
  day: string;
  collected: number;
  dropped: number;
  /** Live stories in the queue right now (the queue has no per-day history). */
  queued: number;
  published: number;
  updated: number;
  checkFailures: number;
  spend: { live: number; backfill: number };
  brokenSources: BrokenSource[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Timestamps of `table.column` that fall on the local `day`, optionally restricted by a SQL condition. */
function timesOn(db: Db, day: string, table: string, column: string, where = "1 = 1"): string[] {
  const mid = Date.parse(`${day}T12:00:00Z`);
  const from = new Date(mid - 2 * DAY_MS).toISOString();
  const to = new Date(mid + 2 * DAY_MS).toISOString();
  const rows = db.raw
    .prepare(`SELECT ${column} AS t FROM ${table} WHERE ${where} AND ${column} >= ? AND ${column} <= ?`)
    .all(from, to) as unknown as { t: string }[];
  return rows.map((r) => r.t).filter((t) => localDay(new Date(t)) === day);
}

/** The counts for a local (São Paulo) day. */
export function buildResumo(db: Db, sources: Source[], day: string, now: Date = new Date()): Resumo {
  const mid = Date.parse(`${day}T12:00:00Z`);
  const spendRows = db.raw
    .prepare("SELECT at, bucket, usd FROM spend WHERE at >= ? AND at <= ?")
    .all(new Date(mid - 2 * DAY_MS).toISOString(), new Date(mid + 2 * DAY_MS).toISOString()) as unknown as {
    at: string;
    bucket: "live" | "backfill";
    usd: number;
  }[];
  const spend = { live: 0, backfill: 0 };
  for (const r of spendRows) if (localDay(new Date(r.at)) === day) spend[r.bucket] += r.usd;

  return {
    day,
    collected: timesOn(db, day, "items", "fetched_at").length,
    dropped: timesOn(db, day, "items", "fetched_at", "status = 'dropped'").length,
    queued: db.storiesByStatus("queued", 100_000).filter((s) => s.mode === "live").length,
    published: db.publishedCountOn(day),
    updated: timesOn(db, day, "article_updates", "at").length,
    checkFailures: timesOn(db, day, "alerts", "at", "kind = 'checagem'").length,
    spend,
    brokenSources: brokenSources(db, sources, now),
  };
}

const usd = (n: number) => `US$ ${n.toFixed(2).replace(".", ",")}`;

export function formatResumo(r: Resumo): string {
  const lines = [
    `Resumo do robô de notícias, ${r.day}`,
    "",
    `Coletados: ${r.collected}`,
    `Descartados: ${r.dropped}`,
    `Na fila (agora): ${r.queued}`,
    `Publicados: ${r.published}`,
    `Atualizados: ${r.updated}`,
    `Falhas de checagem: ${r.checkFailures}`,
    `Gasto ao vivo: ${usd(r.spend.live)}`,
    `Gasto do retroativo: ${usd(r.spend.backfill)}`,
  ];
  if (r.brokenSources.length === 0) {
    lines.push("Fontes quebradas: nenhuma");
  } else {
    lines.push(`Fontes quebradas: ${r.brokenSources.length}`);
    for (const s of r.brokenSources) {
      lines.push(`  ${s.name} (${s.id}): sem sucesso há ${s.silentHours} h${s.lastError ? `; último erro: ${s.lastError}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** `pnpm resumo [dia]`: `dia` is AAAA-MM-DD or `ontem`; the default is today. */
function resolveDay(arg: string | undefined, now: Date): string {
  if (!arg) return localDay(now);
  if (arg === "ontem") return localDay(new Date(now.getTime() - DAY_MS));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg) || Number.isNaN(Date.parse(`${arg}T00:00:00Z`))) {
    throw new Error(`dia deve ser AAAA-MM-DD ou "ontem" (recebido "${arg}")`);
  }
  return arg;
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
  const { opsDeps } = await import("./deps.js");
  const deps = opsDeps();
  try {
    const now = deps.now();
    const day = resolveDay(positionals[0], now);
    const text = formatResumo(buildResumo(deps.db, deps.sources, day, now));
    console.log(text);
    await sendEmail(deps.config, deps.fetchFn, `Tralked Robô: resumo de ${day}`, text);
  } finally {
    await sendPendingAlerts(deps.db, deps.config, deps.fetchFn);
    deps.db.close();
  }
}

runIfMain(import.meta.url, main);
