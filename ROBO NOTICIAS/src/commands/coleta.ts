import { crashAlert, sendPendingAlerts } from "../alerts.js";
import { runColeta } from "../pipeline.js";
import { realDeps } from "./deps.js";

/** `pnpm coleta`: every 30 min, 24 h a day. */
async function main(): Promise<void> {
  const deps = realDeps();
  try {
    let r: Awaited<ReturnType<typeof runColeta>>;
    try {
      r = await runColeta(deps);
    } catch (error) {
      crashAlert(deps.db, "coleta", error);
      throw error;
    }
    if (r.paused) {
      console.log("coleta: PAUSADO, nada feito");
      return;
    }
    console.log(
      [
        `coleta ${new Date().toISOString()}`,
        `  itens: ${r.collected} coletados, ${r.inserted} novos, ${r.sourceFailures} fontes com falha`,
        `  triagem: ${r.triaged} respondidos, ${r.kept} mantidos, ${r.dropped} descartados; ${r.textsFetched} textos baixados`,
        `  histórias: ${r.clustered} itens agrupados, ${r.newStories} novas, ${r.followUps} suítes, ${r.queued} na fila, ${r.covered} já cobertas pelo site, ${r.expired} vencidas, ${r.videoDuplicates} vídeos repetidos`,
        `  publicadas (bomba): ${r.published.length ? r.published.join(", ") : "nenhuma"}; atualizadas: ${r.updated}`,
        ...(r.feedUnavailable ? ["  feed do site indisponível: nada novo entrou na fila"] : []),
        ...(r.stopped ? [`  interrompida: ${r.stopped}`] : []),
      ].join("\n"),
    );
  } finally {
    await sendPendingAlerts(deps.db, deps.config, deps.fetchFn);
    deps.db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
