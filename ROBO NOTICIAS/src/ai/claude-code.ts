import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { currentUsageRef } from "./usage-context.js";
import { RefusalError, UsageLimitError, type Ai, type StructuredOpts } from "./client.js";

/**
 * The robot's AI through Claude Code (`claude -p`) on Lucas's PC, billed to his subscription instead of
 * API credits (Lucas, 05/11/2026). Same `Ai` interface as the API client: the pipeline does not change.
 *
 * Each call is one headless run, isolated from Lucas's own setup (`--safe-mode`: no CLAUDE.md, skills,
 * plugins, hooks or MCP), with no tools, nothing to approve and no transcript saved. Input and output are
 * `stream-json`, so images go in as base64 content blocks; the reply's `structured_output` is checked
 * again with the zod schema. ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN are removed from the child's env:
 * with either present, `claude -p` bills the API instead of the subscription.
 */

export type ClaudeRun = (
  command: string,
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Usage of one run, kept per article in `claude_usage` (the counter Lucas asked for). */
export type ClaudeUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** What the run would cost on the API, as Claude Code estimates it (not a charge). */
  usdEquivalent: number;
  /** Share of the weekly subscription window already used (0-1), when Claude Code reports it. */
  weeklyUtilization: number | null;
};

/** Claude Code's subscription limit messages ("You've hit your weekly limit · resets Mon 12:00am"). */
const LIMIT_HIT = /hit your (?:session|weekly|Opus|Sonnet|Haiku|Fable) limit\s*·\s*resets ([^\n"\\]+)/i;

/** Above this share of the weekly window, the robot stops: the rest is Lucas's (see config). */
export class WeeklyReserveError extends UsageLimitError {}

function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, DISABLE_AUTOUPDATER: "1" };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/** Runs `command` without a shell (the prompt never touches a command line) and feeds `stdin`. */
export const spawnClaude: ClaudeRun = (command, args, stdin, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(stdin, "utf8");
  });

type ResultLine = {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
};

function parseLines(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // a partial or foreign line: ignore it
    }
  }
  return out;
}

function weeklyUtilization(lines: Record<string, unknown>[]): number | null {
  for (const line of lines.toReversed()) {
    if (line.type !== "rate_limit_event") continue;
    const info = line.rate_limit_info as { unifiedWindows?: { seven_day?: { utilization?: unknown } } } | undefined;
    const u = info?.unifiedWindows?.seven_day?.utilization;
    if (typeof u === "number" && Number.isFinite(u)) return u;
  }
  return null;
}

/**
 * The zod schema as Claude Code's `--json-schema` takes it: draft-07, without the `$schema` key (its
 * validator rejects the 2020-12 meta-schema id zod writes by default).
 */
export function cliSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-07", io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function userLine(opts: StructuredOpts<unknown>): string {
  const content = [
    ...(opts.images ?? []).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
    })),
    { type: "text", text: opts.user },
  ];
  return `${JSON.stringify({ type: "user", message: { role: "user", content }, parent_tool_use_id: null })}\n`;
}

/** How long a weekly reading over the reserve holds the robot before one call probes again. */
export const WEEKLY_PROBE_MS = 2 * 60 * 60 * 1000;

export function createClaudeCodeAi(deps: {
  config: Pick<Config, "CLAUDE_BIN" | "CLAUDE_TIMEOUT_MS" | "CLAUDE_WEEKLY_STOP">;
  db?: Pick<Db, "recordClaudeUsage" | "lastWeeklyReading">;
  run?: ClaudeRun;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): Ai {
  const run = deps.run ?? spawnClaude;
  const env = childEnv(deps.env ?? process.env);
  const now = deps.now ?? (() => new Date());
  const { config } = deps;

  /**
   * Stops at the weekly reserve. Only a call records a new reading, so a reading over the reserve older than
   * `WEEKLY_PROBE_MS` lets one call through: after the weekly reset its fresh reading lifts the stop.
   */
  function assertBudget(): void {
    const reading = deps.db?.lastWeeklyReading() ?? null;
    const used = reading && now().getTime() - reading.at.getTime() < WEEKLY_PROBE_MS ? reading.utilization : null;
    if (used !== null && used >= config.CLAUDE_WEEKLY_STOP) {
      throw new WeeklyReserveError(
        `reserva semanal: ${Math.round(used * 100)}% do limite semanal usado (o robô para em ${Math.round(config.CLAUDE_WEEKLY_STOP * 100)}%)`,
      );
    }
  }

  async function structured<T>(opts: StructuredOpts<T>): Promise<T> {
    assertBudget();
    const dir = mkdtempSync(join(tmpdir(), "robo-claude-"));
    try {
      const systemFile = join(dir, "system.md");
      writeFileSync(systemFile, opts.system, "utf8");
      const args = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--safe-mode",
        "--tools",
        "",
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
        "--max-turns",
        "3",
        "--model",
        opts.model,
        "--effort",
        opts.effort,
        "--append-system-prompt-file",
        systemFile,
        "--json-schema",
        JSON.stringify(cliSchema(opts.schema)),
      ];
      const { code, stdout, stderr } = await run(config.CLAUDE_BIN, args, userLine(opts as StructuredOpts<unknown>), env, config.CLAUDE_TIMEOUT_MS);

      const limit = `${stdout}\n${stderr}`.match(LIMIT_HIT);
      if (limit) throw new UsageLimitError(limit[1]!.trim());

      const lines = parseLines(stdout);
      const result = lines.toReversed().find((l): l is ResultLine => l.type === "result");
      const usage = result?.usage ?? {};
      const models = Object.keys(result?.modelUsage ?? {});
      deps.db?.recordClaudeUsage(
        {
          model: models[0] ?? opts.model,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          usdEquivalent: result?.total_cost_usd ?? 0,
          weeklyUtilization: weeklyUtilization(lines),
        },
        { purpose: opts.purpose, ...currentUsageRef() },
        now(),
      );

      if (result?.stop_reason === "refusal") throw new RefusalError(opts.purpose, opts.model);
      if (!result || result.is_error || result.subtype !== "success" || result.structured_output === undefined) {
        const detail = (result?.result ?? stderr ?? "").slice(0, 300).trim() || `exit ${code}`;
        throw new Error(`No structured output for ${opts.purpose} (${result?.subtype ?? "sem resultado"}): ${detail}`);
      }
      return opts.schema.parse(result.structured_output);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    structured,
    batchRequest() {
      throw new Error("retroativo desligado: o motor claude-code não usa a Batches API");
    },
    recordBatchUsage() {},
    assertBudget,
  };
}
