import "dotenv/config";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { sendPendingAlerts } from "../alerts.js";
import { createGuideApi } from "../guias/api.js";
import { loadDryRunConfig, loadGuideConfig } from "../guias/config.js";
import { openGuideDb } from "../guias/db.js";
import { dryRun } from "../guias/dry-run.js";
import { runGuideRequest } from "../guias/pipeline.js";
import { createPoliteState, politeFetch, politeFetchImage } from "../guias/polite-fetch.js";
import { acquireLock } from "../lock.js";
import { runIfMain } from "./run.js";

export const GUIDE_LOCK_FILE = "guia.lock";
/** A guide run can take hours (many pages, polite intervals, images); a lock older than this is a crashed run. */
export const GUIDE_LOCK_STALE_MS = 3 * 60 * 60 * 1000;

export type GuiaArgs = { dryRun: false } | { dryRun: true; appId?: number; requestId?: string; dataDir?: string };

/** `pnpm guia` runs one request; `pnpm guia -- --ensaio --appid <n> | --pedido <id> [--dados <dir>]` is the free dry run. */
export function parseGuiaArgs(argv: string[]): GuiaArgs {
  const args = argv.filter((a) => a !== "--");
  if (!args.includes("--ensaio")) return { dryRun: false };
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const appId = value("--appid");
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

/** `pnpm guia`: processes ONE guide request of the queue (the scheduler runs it every 30 min). */
async function main(): Promise<void> {
  const args = parseGuiaArgs(process.argv.slice(2));
  if (args.dryRun) return ensaio(args);

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
    });
    console.log(`guia ${new Date().toISOString()}: ${outcome === "idle" ? "nada na fila" : outcome}`);
  } finally {
    // Alerts (e.g. guia-falha-robo) go by e-mail when RESEND_API_KEY and ALERT_EMAIL are set; never throws.
    await sendPendingAlerts(db, config, fetch, new Date(), "de guias");
    lock.release();
    db.close();
  }
}

runIfMain(import.meta.url, main);
