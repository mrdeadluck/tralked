import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BudgetExceededError, PRICES, RefusalError, costUsd, createAi } from "../src/ai/client.js";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db.js";

const NOW = new Date("2026-10-31T15:00:00Z"); // 12:00 in America/Sao_Paulo
const config = loadConfig({ ANTHROPIC_API_KEY: "test", TRALKED_API_KEY: "test" });
const Schema = z.object({ title: z.string(), score: z.number() });

interface FakeResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: "text"; text: string }[];
  usage?: Partial<Anthropic.Messages.Usage>;
}

type Params = Record<string, any>;

/** Mimics the SDK's `parse`: runs `output_config.format.parse` over every text block. */
function fakeParse(resp: FakeResponse) {
  return vi.fn(async (params: Params) => {
    const content = resp.content ?? [{ type: "text" as const, text: JSON.stringify({ title: "Oi", score: 7 }) }];
    let parsed: unknown = null;
    for (const block of content) {
      const out = params.output_config.format.parse(block.text);
      if (parsed === null) parsed = out;
    }
    return {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: resp.model ?? params.model,
      stop_reason: resp.stop_reason ?? "end_turn",
      content,
      usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: null, cache_creation_input_tokens: null, ...resp.usage },
      parsed_output: parsed,
    };
  });
}

function fakeClient(resp: FakeResponse = {}) {
  const parse = fakeParse(resp);
  const betaParse = fakeParse(resp);
  const client = { messages: { parse }, beta: { messages: { parse: betaParse } } } as unknown as Anthropic;
  return { client, parse, betaParse };
}

const baseOpts = {
  purpose: "triage",
  model: "claude-haiku-5-5",
  effort: "low" as const,
  system: "You are the triage editor.",
  user: "Headline: X",
  schema: Schema,
};

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("costUsd", () => {
  it("prices opus 5.5 at 4/20 per 1M tokens and halves it in batch", () => {
    expect(PRICES["claude-opus-5-5"]).toEqual({ in: 4, out: 20 });
    expect(costUsd("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 })).toBe(24);
    expect(costUsd("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }, true)).toBe(12);
  });

  it("prices cache reads at 0.1x and cache writes at 1.25x input", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1e6 })).toBeCloseTo(0.4);
    expect(costUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1e6 })).toBeCloseTo(5);
    expect(costUsd("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: null })).toBeCloseTo(0.6);
  });

  it("accepts dated model ids and rejects unknown models", () => {
    expect(costUsd("claude-sonnet-5-5-20261001", { input_tokens: 1e6, output_tokens: 0 })).toBe(2);
    expect(() => costUsd("gpt-x", { input_tokens: 1, output_tokens: 1 })).toThrow(/price/i);
  });
});

describe("structured", () => {
  it("sends images as base64 blocks before the user text (vision)", async () => {
    const { client, parse } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });
    await ai.structured({ ...baseOpts, bucket: "live", images: [{ mediaType: "image/jpeg", data: Buffer.from("abc") }] });
    expect(parse.mock.calls[0]![0].messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from("abc").toString("base64") } },
          { type: "text", text: "Headline: X" },
        ],
      },
    ]);
  });

  it("sends a cached system block and output_config, returns parsed output and records live spend", async () => {
    const { client, parse, betaParse } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });

    const out = await ai.structured({ ...baseOpts, bucket: "live" });

    expect(out).toEqual({ title: "Oi", score: 7 });
    expect(betaParse).not.toHaveBeenCalled();
    const params = parse.mock.calls[0]![0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(16000);
    expect(params.system).toEqual([
      { type: "text", text: "You are the triage editor.", cache_control: { type: "ephemeral" } },
    ]);
    expect(params.messages).toEqual([{ role: "user", content: "Headline: X" }]);
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("fallbacks");

    // 1M haiku input tokens = $0.10
    expect(db.spentToday("live", NOW)).toBeCloseTo(0.1);
    expect(db.spentTotal("backfill")).toBe(0);
  });

  it("records backfill spend in the backfill bucket", async () => {
    const { client } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });
    await ai.structured({ ...baseOpts, bucket: "backfill" });
    expect(db.spentTotal("backfill")).toBeCloseTo(0.1);
    expect(db.spentTotal("live")).toBe(0);
  });

  it("uses beta.messages.parse with the server-side fallback beta when fallbacks is set", async () => {
    const { client, parse, betaParse } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });

    await ai.structured({ ...baseOpts, bucket: "live", model: "claude-opus-5-5", effort: "high", fallbacks: true, maxTokens: 32000 });

    expect(parse).not.toHaveBeenCalled();
    const params = betaParse.mock.calls[0]![0];
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.max_tokens).toBe(32000);
    expect(params.output_config.effort).toBe("high");
    expect(db.spentToday("live", NOW)).toBeCloseTo(4);
  });

  it("prices by the model that actually answered when it is known", async () => {
    const { client } = fakeClient({ model: "claude-sonnet-5-5" });
    const ai = createAi({ client, db, config, now: () => NOW });
    await ai.structured({ ...baseOpts, bucket: "live", model: "claude-opus-5-5", fallbacks: true });
    expect(db.spentToday("live", NOW)).toBeCloseTo(2);
  });

  it("throws RefusalError on a refusal, even with non-JSON text, and still records spend", async () => {
    const { client } = fakeClient({
      stop_reason: "refusal",
      content: [{ type: "text", text: "I can't help with that." }],
    });
    const ai = createAi({ client, db, config, now: () => NOW });

    await expect(ai.structured({ ...baseOpts, bucket: "live" })).rejects.toBeInstanceOf(RefusalError);
    expect(db.spentToday("live", NOW)).toBeCloseTo(0.1);
  });

  it("throws when there is no parsed output, after recording spend", async () => {
    const { client } = fakeClient({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"title":"cut' }] });
    const ai = createAi({ client, db, config, now: () => NOW });

    await expect(ai.structured({ ...baseOpts, bucket: "live" })).rejects.toThrow(/structured output/i);
    expect(db.spentToday("live", NOW)).toBeCloseTo(0.1);
  });

  it("blocks live calls once the day's live spend reaches the budget, but allows backfill", async () => {
    db.recordSpend("live", "earlier", "claude-opus-5-5", 5, NOW);
    const { client, parse } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });

    await expect(ai.structured({ ...baseOpts, bucket: "live" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(parse).not.toHaveBeenCalled();

    await expect(ai.structured({ ...baseOpts, bucket: "backfill" })).resolves.toEqual({ title: "Oi", score: 7 });
  });

  it("blocks backfill calls once total backfill spend reaches the budget", () => {
    db.recordSpend("backfill", "old", "claude-opus-5-5", 70, new Date("2026-09-01T12:00:00Z"));
    const { client } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });
    expect(() => ai.assertBudget("backfill")).toThrow(BudgetExceededError);
    expect(() => ai.assertBudget("live")).not.toThrow();
  });

  it("fails before calling the client for a model without a price", async () => {
    const { client, parse } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });
    await expect(ai.structured({ ...baseOpts, bucket: "live", model: "claude-unknown-1" })).rejects.toThrow(/price/i);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("batch helpers", () => {
  it("builds a batch request without fallbacks, with cached system and plain JSON format", () => {
    const { client } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });

    const req = ai.batchRequest({ ...baseOpts, model: "claude-opus-5-5", effort: "high", customId: "story-42" });

    expect(req.custom_id).toBe("story-42");
    expect(req.params.model).toBe("claude-opus-5-5");
    expect(req.params.max_tokens).toBe(16000);
    expect(req.params.system).toEqual([
      { type: "text", text: "You are the triage editor.", cache_control: { type: "ephemeral" } },
    ]);
    expect(req.params.messages).toEqual([{ role: "user", content: "Headline: X" }]);
    expect(req.params.output_config?.effort).toBe("high");
    expect(req.params.output_config?.format?.type).toBe("json_schema");
    expect(req.params).not.toHaveProperty("fallbacks");
    expect(req.params).not.toHaveProperty("betas");
    // Plain data only (no `parse` function), so it survives a JSON round-trip unchanged.
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("recordBatchUsage records backfill spend at batch prices", () => {
    const { client } = fakeClient();
    const ai = createAi({ client, db, config, now: () => NOW });
    ai.recordBatchUsage("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }, "write");
    expect(db.spentTotal("backfill")).toBe(12);
    expect(db.spentTotal("live")).toBe(0);
  });
});
