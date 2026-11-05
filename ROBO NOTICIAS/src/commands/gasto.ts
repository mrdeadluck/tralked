import { parseArgs } from "node:util";
import type { ArticleUsage, Db } from "../db.js";
import { runIfMain } from "./run.js";

/**
 * `pnpm gasto [--dias N]`: what the robot used of Lucas's Claude subscription, per published article
 * (news and pautas), plus the collection's share (triage and clustering) and the weekly window.
 * "US$" is what the same tokens would cost on the API, as Claude Code estimates it: the subscription
 * itself charges nothing per call.
 */

export type GastoReport = {
  days: number;
  articles: ArticleUsage[];
  collection: { runs: number; tokens: number; usdEquivalent: number };
  weeklyUtilization: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildGasto(db: Db, days: number, now: Date = new Date()): GastoReport {
  const since = new Date(now.getTime() - days * DAY_MS);
  return {
    days,
    articles: db.usagePerArticle(since),
    collection: db.collectionUsage(since),
    weeklyUtilization: db.lastWeeklyUtilization(),
  };
}

const num = (n: number) => Math.round(n).toLocaleString("pt-BR");
const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function formatGasto(r: GastoReport): string {
  const lines: string[] = [`Gasto da assinatura do Claude: últimos ${r.days} dia(s)`, ""];
  if (r.articles.length === 0) {
    lines.push("Nenhuma matéria publicada pelo Claude Code no período.");
  } else {
    for (const a of r.articles) {
      lines.push(`${when(a.publishedAt)}  ${num(a.tokens).padStart(9)} tokens  ${usd(a.usdEquivalent).padStart(10)}  ${a.kind === "pauta" ? "[pauta] " : ""}${a.title}`);
    }
    const tokens = r.articles.reduce((s, a) => s + a.tokens, 0);
    const money = r.articles.reduce((s, a) => s + a.usdEquivalent, 0);
    lines.push(
      "",
      `Matérias: ${r.articles.length} · ${num(tokens)} tokens · ${usd(money)} · média por matéria ${num(tokens / r.articles.length)} tokens (${usd(money / r.articles.length)})`,
    );
  }
  lines.push(`Coleta (triagem e agrupamento): ${r.collection.runs} chamadas · ${num(r.collection.tokens)} tokens · ${usd(r.collection.usdEquivalent)}`);
  lines.push(
    r.weeklyUtilization === null
      ? "Limite semanal: ainda sem leitura"
      : `Limite semanal da assinatura: ${Math.round(r.weeklyUtilization * 100)}% usado (a leitura inclui o seu uso, não só o do robô)`,
    "US$ = quanto custaria pela API; a assinatura não cobra por chamada.",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { dias: { type: "string", default: "1" } }, strict: true });
  const days = Number(values.dias);
  if (!Number.isFinite(days) || days <= 0) {
    console.error("uso: pnpm gasto [--dias N]");
    process.exitCode = 2;
    return;
  }
  const { opsDeps } = await import("./deps.js");
  const deps = opsDeps();
  try {
    console.log(formatGasto(buildGasto(deps.db, days)));
  } finally {
    deps.db.close();
  }
}

runIfMain(import.meta.url, main);
