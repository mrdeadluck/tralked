import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createAi } from "../ai/client.js";
import { loadConfig, loadSources } from "../config.js";
import { openDb } from "../db.js";
import type { PipelineDeps } from "../pipeline.js";
import { createTralked } from "../tralked.js";

/** The real dependencies of the live commands: .env config, fontes.json, SQLite, Anthropic and the site API. */
export function realDeps(): PipelineDeps {
  const config = loadConfig();
  const db = openDb(config.DATA_DIR);
  const now = () => new Date();
  return {
    db,
    ai: createAi({ client: new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }), db, config, now }),
    tralked: createTralked({ baseUrl: config.TRALKED_API_URL, key: config.TRALKED_API_KEY }),
    sources: loadSources(),
    config,
    now,
    fetchFn: (input, init) => fetch(input, init),
    log: (line) => console.log(line),
  };
}
