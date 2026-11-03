import "dotenv/config";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { sendPendingAlerts } from "../alerts.js";
import { createGuideApi } from "../guias/api.js";
import { loadDryRunConfig, loadGuideConfig } from "../guias/config.js";
import { openGuideDb } from "../guias/db.js";
import { describeDraft, latestDraft } from "../guias/drafts.js";
import { dryRun } from "../guias/dry-run.js";
import { runGuideRequest } from "../guias/pipeline.js";
import { createPoliteState, politeFetch, politeFetchImage } from "../guias/polite-fetch.js";
import { acquireLock } from "../lock.js";
import { runIfMain } from "./run.js";

export const GUIDE_LOCK_FILE = "guia.lock";
/** A guide run can take hours (many pages, polite intervals, images); a lock older than this is a crashed run. */
export const GUIDE_LOCK_STALE_MS = 3 * 60 * 60 * 1000;

/** The probe's default: the frame and the first 2 chapters (about US$ 0.50 to 1). */
export const PROBE_DEFAULT_CHAPTERS = 2;

export type GuiaArgs =
  | { dryRun: false; direct?: { appId: number; update: boolean; updatePsn?: boolean; probe?: { chapters: number } }; draft?: undefined }
  | { dryRun: false; draft: { requestId: string; dataDir?: string } }
  | { dryRun: true; appId?: number; requestId?: string; dataDir?: string };

/**
 * `pnpm guia` runs one request; `pnpm guia -- --appid <n> [--atualizar | --atualizar-psn] [--sonda [--capitulos N]]` runs a game without a
 * request (the probe writes only the frame and N chapters); `pnpm guia -- --ensaio --appid <n> | --pedido <id>
 * [--dados <dir>]` is the free dry run; `pnpm guia -- --rascunho <pedido> [--dados <dir>]` shows the last draft.
 */
export function parseGuiaArgs(argv: string[]): GuiaArgs {
  const args = argv.filter((a) => a !== "--");
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const appId = value("--appid");
  if (args.includes("--rascunho")) {
    const requestId = value("--rascunho");
    if (!requestId || requestId.startsWith("--")) throw new Error("rascunho: use --rascunho <pedido> (o id do pedido, ou direto-<appid>)");
    const dataDir = value("--dados");
    return { dryRun: false, draft: { requestId, ...(dataDir !== undefined ? { dataDir } : {}) } };
  }
  if (!args.includes("--ensaio")) {
    const updatePsn = args.includes("--atualizar-psn");
    if (args.includes("--appid") || args.includes("--atualizar") || updatePsn || args.includes("--sonda")) {
      if (appId === undefined || !/^\d+$/.test(appId)) throw new Error(`appid inválido ou ausente: ${appId ?? "(nenhum)"}; use --appid <n>`);
      const chapters = value("--capitulos") ?? String(PROBE_DEFAULT_CHAPTERS);
      if (args.includes("--sonda") && (!/^\d+$/.test(chapters) || Number(chapters) < 1)) {
        throw new Error(`sonda: --capitulos inválido: ${chapters}; use um inteiro de 1 em diante`);
      }
      return {
        dryRun: false,
        direct: {
          appId: Number(appId),
          update: args.includes("--atualizar") || updatePsn,
          ...(updatePsn ? { updatePsn: true } : {}),
          ...(args.includes("--sonda") ? { probe: { chapters: Number(chapters) } } : {}),
        },
      };
    }
    return { dryRun: false };
  }
  const requestId = value("--pedido");
  const dataDir = value("--dados");
  if (appId === undefined && requestId === undefined) throw new Error("ensaio: informe --appid <n> ou --pedido <id>");
  if (appId !== undefined && !/^\d+$/.test(appId)) throw new Error(`ensaio: appid inválido: ${appId}`);
  return {
    dryRun: true,
    ...(appId !== undefined ? { appId: Number(appId) } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(dataDir !== undefined ? { dataDir } : {}),
  };
}

/** The dry run: cached pages and extraction only, no AI, no network, no lock (it changes nothing a run reads). */
async function ensaio(args: Extract<GuiaArgs, { dryRun: true }>): Promise<void> {
  const config = loadDryRunConfig();
  const db = openGuideDb(args.dataDir ?? config.DATA_DIR_GUIAS);
  try {
    const { ok } = await dryRun({ db, config, appId: args.appId, requestId: args.requestId, log: (line) => console.log(line) });
    console.log(ok ? "ensaio: o pedido sairia (gate, limites e tamanho ok)" : "ensaio: o pedido NÃO sairia como está (veja acima)");
  } finally {
    db.close();
  }
}

/** `--rascunho`: the request's last draft, grouped by kind and scope. No AI, no network, no lock. False when there is none. */
export function showDraft(dataDir: string, requestId: string, log: (line: string) => void): boolean {
  const db = openGuideDb(dataDir);
  try {
    const draft = latestDraft(db, requestId);
    if (!draft) {
      log(`rascunho: nenhum rascunho salvo para ${requestId} em ${dataDir}`);
      return false;
    }
    for (const line of describeDraft(draft)) log(line);
    return true;
  } finally {
    db.close();
  }
}

/** `pnpm guia`: processes ONE guide request of the queue (the scheduler runs it every 30 min); with `--appid`, one game directly. */
async function main(): Promise<void> {
  const args = parseGuiaArgs(process.argv.slice(2));
  if (args.dryRun) return ensaio(args);
  if (args.draft) {
    showDraft(args.draft.dataDir ?? loadDryRunConfig().DATA_DIR_GUIAS, args.draft.requestId, (line) => console.log(line));
    return;
  }

  const config = loadGuideConfig();
  const db = openGuideDb(config.DATA_DIR_GUIAS);
  const lock = acquireLock(join(config.DATA_DIR_GUIAS, GUIDE_LOCK_FILE), new Date(), GUIDE_LOCK_STALE_MS);
  if (!lock) {
    console.log(`guia ${new Date().toISOString()}: outra execução está em andamento`);
    db.close();
    return;
  }
  try {
    // One politeness state for pages and images: same host intervals and robots.txt cache.
    const polite = { db, state: createPoliteState() };
    const outcome = await runGuideRequest({
      api: createGuideApi({ baseUrl: config.TRALKED_API_URL, key: config.TRALKED_GUIDES_API_KEY }),
      db,
      client: new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }),
      config,
      fetchPage: (url) => politeFetch(url, polite),
      fetchImage: (url) => politeFetchImage(url, polite),
      now: () => new Date(),
      log: (line) => console.log(line),
      ...(args.direct ? { direct: args.direct } : {}),
    });
    console.log(`guia ${new Date().toISOString()}: ${outcome === "idle" ? "nada na fila" : outcome === "probe" ? "sonda" : outcome}`);
  } finally {
    // Alerts (e.g. guia-falha-robo) go by e-mail when RESEND_API_KEY and ALERT_EMAIL are set; never throws.
    await sendPendingAlerts(db, config, fetch, new Date(), "de guias");
    lock.release();
    db.close();
  }
}

runIfMain(import.meta.url, main);
