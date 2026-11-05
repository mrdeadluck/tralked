import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { createClaudeCodeAi } from "./claude-code.js";
import { createAi, type Ai } from "./client.js";

/** The robot's AI as `AI_BACKEND` says: Claude Code on Lucas's PC (default) or the Anthropic API. */
export function createRobotAi(config: Config, db: Db, now: () => Date = () => new Date()): Ai {
  if (config.AI_BACKEND === "api") {
    return createAi({ client: new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }), db, config, now });
  }
  return createClaudeCodeAi({ config, db, now });
}
