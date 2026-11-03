import "dotenv/config";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createGuideApi } from "../guias/api.js";
import { loadGuideConfig } from "../guias/config.js";
import { openGuideDb } from "../guias/db.js";
import { runGuideRequest } from "../guias/pipeline.js";
import { createPoliteState, politeFetch, politeFetchImage } from "../guias/polite-fetch.js";
import { acquireLock } from "../lock.js";
import { runIfMain } from "./run.js";

export const GUIDE_LOCK_FILE = "guia.lock";
/** A guide run can take hours (many pages, polite intervals, images); a lock older than this is a crashed run. */
export const GUIDE_LOCK_STALE_MS = 3 * 60 * 60 * 1000;

/** `pnpm guia`: processes ONE guide request of the queue (the scheduler runs it every 30 min). */
async function main(): Promise<void> {
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
    lock.release();
    db.close();
  }
}

runIfMain(import.meta.url, main);
