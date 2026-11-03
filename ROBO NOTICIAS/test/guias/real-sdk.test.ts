import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAi, MAX_NONSTREAMING_TOKENS } from "../../src/ai/client.js";
import { loadConfig } from "../../src/config.js";
import { openDb } from "../../src/db.js";
import { extractFacts } from "../../src/guias/extract.js";

// Uses the REAL Anthropic client class with a fake fetch (no network): the SDK's own client-side
// guard ("Streaming is required...") is exercised, which mocked clients never do.

const config = loadConfig({ ANTHROPIC_API_KEY: "test", TRALKED_API_KEY: "test" });
const FACTS = JSON.stringify({ chapters: [], achievements: [], platform: "unknown", complete: true });
const usage = { input_tokens: 10, output_tokens: 5 };

const message = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text: FACTS }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage,
};

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamBody(): string {
  return [
    sse("message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: FACTS } }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

function realClient() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return body.stream
      ? new Response(streamBody(), { status: 200, headers: { "content-type": "text/event-stream" } })
      : new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  });
  const client = new Anthropic({ apiKey: "test", fetch: fetch as never, maxRetries: 0 });
  return { client, fetch, bodies };
}

let db: ReturnType<typeof openDb>;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("chamadas longas no SDK real", () => {
  it("extractFacts (max_tokens 32000) chega ao fetch por streaming, sem erro do SDK, e registra o gasto", async () => {
    const { client, fetch, bodies } = realClient();
    const ai = createAi({ client, db, config });
    const source = { name: "PowerPyx", url: "https://www.powerpyx.com/x/", role: "roteiro_psn" as const, language: "en" as const };

    const facts = await extractFacts({ url: source.url, text: "page text", html: "" }, source, { ai, model: "claude-sonnet-5-5" });

    expect(facts.source).toEqual(source);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toMatchObject({ max_tokens: 32000, stream: true });
    expect(db.spentTotal("backfill")).toBeGreaterThan(0);
  });

  it("chamada curta continua sem streaming", async () => {
    const { client, bodies } = realClient();
    const ai = createAi({ client, db, config });
    await ai.structured({
      bucket: "backfill", purpose: "t", model: "claude-sonnet-5-5", effort: "low", system: "s", user: "u",
      schema: (await import("../../src/guias/facts.js")).llmFactsSchema, maxTokens: MAX_NONSTREAMING_TOKENS,
    });
    expect(bodies[0]!.stream).toBeUndefined();
  });

  it("writer (16000) e fallbacks beta com 32000 passam pelo guard do SDK", async () => {
    const { client, bodies } = realClient();
    const ai = createAi({ client, db, config });
    const schema = (await import("../../src/guias/facts.js")).llmFactsSchema;
    const common = { bucket: "backfill" as const, purpose: "t", model: "claude-sonnet-5-5", effort: "low" as const, system: "s", user: "u", schema };
    await ai.structured({ ...common, maxTokens: 16000 });
    await ai.structured({ ...common, maxTokens: 32000, fallbacks: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.stream).toBeUndefined();
    expect(bodies[1]!.stream).toBe(true);
  });
});
