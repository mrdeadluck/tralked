import Anthropic from "@anthropic-ai/sdk";
import { sendPendingAlerts } from "../alerts.js";
import { PHASES, runRetroativo, type Phase, type RetroativoReport } from "../backfill.js";
import { realDeps } from "./deps.js";
import { runIfMain } from "./run.js";

const USAGE = `Uso: pnpm retroativo [${PHASES.join(" | ")}]  (sem fase: roda todas, retomando de onde parou)`;

export function formatRetroativo(r: RetroativoReport, now: Date): string {
  return [
    `retroativo ${now.toISOString()}: fases ${r.ran.join(", ") || "nenhuma"}`,
    `  descobrir: ${r.discovered} itens achados, ${r.inserted} novos, ${r.sourceFailures} falhas de fonte`,
    `  triar: ${r.triaged} respondidos, ${r.kept} mantidos`,
    `  agrupar: ${r.clustered} itens agrupados, ${r.newStories} histórias novas`,
    `  escrever: ${r.covered} já cobertas pelo site, ${r.selected} escolhidas, ${r.submitted} enviadas no lote (${r.trimmed} fora pelo teto)${r.batchId ? ` ${r.batchId}` : ""}, ${r.drafted} rascunhos, ${r.ready} prontas, ${r.failed} falhas`,
    `  publicar: ${r.published} publicadas, ${r.publishFailed} recusadas pelo site${r.paused ? " (PAUSADO)" : ""}`,
    ...(r.stopped ? [`  interrompido: ${r.stopped}`] : []),
  ].join("\n");
}

/** `pnpm retroativo [fase]`: the resumable 3-month backfill (run again after a stop to continue). */
async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (arg !== undefined && !(PHASES as readonly string[]).includes(arg)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const deps = realDeps();
  try {
    const client = new Anthropic({ apiKey: deps.config.ANTHROPIC_API_KEY });
    const report = await runRetroativo(
      {
        ...deps,
        batches: client.messages.batches,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        rand: Math.random,
      },
      arg as Phase | undefined,
    );
    console.log(formatRetroativo(report, deps.now()));
  } finally {
    await sendPendingAlerts(deps.db, deps.config, deps.fetchFn);
    deps.db.close();
  }
}

runIfMain(import.meta.url, main);
