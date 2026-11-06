import "dotenv/config";
import { createRobotAi } from "../ai/backend.js";
import { loadConfig, loadSources } from "../config.js";
import { openDb } from "../db.js";
import { loadXProfiles } from "../media/xposts.js";
import { loadFamousGames } from "../pautas.js";
import type { PipelineDeps } from "../pipeline.js";
import { createTralked } from "../tralked.js";

/** The dependencies of the operations commands (`resumo`, `despublicar`): no Anthropic client. */
export function opsDeps() {
  const config = loadConfig();
  return {
    config,
    db: openDb(config.DATA_DIR),
    tralked: createTralked({ baseUrl: config.TRALKED_API_URL, key: config.TRALKED_API_KEY }),
    sources: loadSources(),
    fetchFn: ((input: string, init?: RequestInit) => fetch(input, init)) as (input: string, init?: RequestInit) => Promise<Response>,
    now: () => new Date(),
    log: (line: string) => console.log(line),
  };
}

/**
 * The real dependencies of the live commands: .env config, fontes.json, jogos-famosos.json (Pautas
 * Tralked), SQLite, the AI (Claude Code or the Anthropic API, `AI_BACKEND`) and the site API.
 */
export function realDeps(): PipelineDeps {
  const config = loadConfig();
  const db = openDb(config.DATA_DIR);
  const now = () => new Date();
  return {
    db,
    ai: createRobotAi(config, db, now),
    tralked: createTralked({ baseUrl: config.TRALKED_API_URL, key: config.TRALKED_API_KEY }),
    sources: loadSources(),
    config,
    now,
    fetchFn: (input, init) => fetch(input, init),
    log: (line) => console.log(line),
    famousGames: loadFamousGames(),
    xProfiles: loadXProfiles(),
  };
}
