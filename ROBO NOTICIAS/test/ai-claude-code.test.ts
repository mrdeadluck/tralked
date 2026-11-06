import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createClaudeCodeAi, WeeklyReserveError, type ClaudeRun } from "../src/ai/claude-code.js";
import { BudgetExceededError, RefusalError, UsageLimitError } from "../src/ai/client.js";
import { withUsageRef } from "../src/ai/usage-context.js";
import { openDb, type Db } from "../src/db.js";

const NOW = new Date("2026-11-05T15:00:00Z");
const config = { CLAUDE_BIN: "claude", CLAUDE_TIMEOUT_MS: 1000, CLAUDE_WEEKLY_STOP: 0.9 };
const Schema = z.object({ ok: z.boolean() });
const opts = {
  bucket: "live" as const,
  purpose: "writer",
  model: "claude-haiku-5-5",
  effort: "low" as const,
  system: "Você é o editor.",
  user: "Escreva.",
  schema: Schema,
};

const rateLimit = (utilization: number) =>
  JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { seven_day: { utilization } } } });
const result = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "end_turn",
    structured_output: { ok: true },
    total_cost_usd: 0.12,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
    modelUsage: { "claude-haiku-5-5": {} },
    ...extra,
  });

type Call = { command: string; args: string[]; stdin: string; env: NodeJS.ProcessEnv; system: string };

function fakeRun(stdout: string, code = 0, stderr = ""): { run: ClaudeRun; calls: Call[] } {
  const calls: Call[] = [];
  const run: ClaudeRun = async (command, args, stdin, env) => {
    const file = args[args.indexOf("--append-system-prompt-file") + 1]!;
    calls.push({ command, args, stdin, env, system: readFileSync(file, "utf8") });
    return { code, stdout, stderr };
  };
  return { run, calls };
}

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("createClaudeCodeAi", () => {
  it("runs claude -p isolated, with the model, effort, system and schema, and reads structured_output", async () => {
    const { run, calls } = fakeRun(`${rateLimit(0.45)}\n${result()}\n`);
    const ai = createClaudeCodeAi({ config, db, run, env: {}, now: () => NOW });

    await expect(ai.structured(opts)).resolves.toEqual({ ok: true });

    const { args, system, command } = calls[0]!;
    expect(command).toBe("claude");
    expect(args.slice(0, 1)).toEqual(["-p"]);
    for (const pair of [
      ["--input-format", "stream-json"],
      ["--output-format", "stream-json"],
      ["--tools", ""],
      ["--permission-mode", "dontAsk"],
      ["--max-turns", "3"],
      ["--model", "claude-haiku-5-5"],
      ["--effort", "low"],
    ]) {
      expect(args[args.indexOf(pair[0]!) + 1]).toBe(pair[1]);
    }
    expect(args).toEqual(expect.arrayContaining(["--verbose", "--safe-mode", "--no-session-persistence"]));
    expect(args).not.toContain("--bare");
    expect(system).toBe("Você é o editor.");
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!);
    expect(schema.properties.ok.type).toBe("boolean");
    // Claude Code's validator refuses zod's default 2020-12 meta-schema id.
    expect(schema.$schema).toBeUndefined();
  });

  it("sends images as base64 blocks before the text, in one stream-json user line", async () => {
    const { run, calls } = fakeRun(result());
    const ai = createClaudeCodeAi({ config, db, run, env: {} });
    await ai.structured({ ...opts, images: [{ mediaType: "image/png", data: Buffer.from("png") }] });

    const line = JSON.parse(calls[0]!.stdin.trim());
    expect(line.type).toBe("user");
    expect(line.message.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png").toString("base64") } });
    expect(line.message.content[1]).toEqual({ type: "text", text: "Escreva." });
  });

  it("removes the API keys from the child's env (with them, claude -p bills the API)", async () => {
    const { run, calls } = fakeRun(result());
    const ai = createClaudeCodeAi({ config, db, run, env: { ANTHROPIC_API_KEY: "sk", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" } });
    await ai.structured(opts);
    expect(calls[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(calls[0]!.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(calls[0]!.env.PATH).toBe("/bin");
  });

  it("records the run's usage for the article in context (the per-article counter)", async () => {
    const { run } = fakeRun(`${rateLimit(0.46)}\n${result()}`);
    const ai = createClaudeCodeAi({ config, db, run, env: {}, now: () => NOW });
    await withUsageRef({ storyId: 42 }, () => ai.structured(opts));

    const row = db.raw.prepare("SELECT * FROM claude_usage").get() as Record<string, unknown>;
    expect(row).toMatchObject({
      purpose: "writer",
      model: "claude-haiku-5-5",
      story_id: 42,
      pauta_id: null,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 10,
      cache_write_tokens: 5,
      usd_equivalent: 0.12,
      weekly_utilization: 0.46,
    });
    expect(db.lastWeeklyUtilization()).toBe(0.46);
  });

  it("throws UsageLimitError (a BudgetExceededError) when the subscription limit is hit", async () => {
    const text = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "You've hit your weekly limit · resets Mon 12:00am" });
    const { run } = fakeRun(text, 1);
    const ai = createClaudeCodeAi({ config, db, run, env: {} });
    const error = await ai.structured(opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageLimitError);
    expect(error).toBeInstanceOf(BudgetExceededError);
    expect((error as UsageLimitError).resetText).toBe("Mon 12:00am");
  });

  it("stops before running once the weekly reserve is reached", async () => {
    db.recordClaudeUsage(
      { model: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usdEquivalent: 0, weeklyUtilization: 0.91 },
      { purpose: "triage" },
    );
    const { run, calls } = fakeRun(result());
    const ai = createClaudeCodeAi({ config, db, run, env: {} });
    await expect(ai.structured(opts)).rejects.toBeInstanceOf(WeeklyReserveError);
    expect(calls).toHaveLength(0);
  });

  it("fails without structured output, and maps a refusal to RefusalError", async () => {
    const none = createClaudeCodeAi({ config, db, run: fakeRun(result({ subtype: "error_max_turns", structured_output: undefined })).run, env: {} });
    await expect(none.structured(opts)).rejects.toThrow(/No structured output for writer/);

    const refused = createClaudeCodeAi({ config, db, run: fakeRun(result({ stop_reason: "refusal" })).run, env: {} });
    await expect(refused.structured(opts)).rejects.toBeInstanceOf(RefusalError);

    const wrong = createClaudeCodeAi({ config, db, run: fakeRun(result({ structured_output: { ok: "sim" } })).run, env: {} });
    await expect(wrong.structured(opts)).rejects.toThrow();
  });

  it("has no Batches API: the backfill is off", () => {
    const ai = createClaudeCodeAi({ config, db, run: fakeRun("").run, env: {} });
    expect(() => ai.batchRequest({ ...opts, customId: "x" })).toThrow(/retroativo desligado/);
  });
});
