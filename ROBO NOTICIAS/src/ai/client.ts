import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Config } from "../config.js";
import type { Db, SpendBucket } from "../db.js";

/** What `createAi` needs of a database: the news robot passes its `Db`, the guide robot a per-request adapter. */
export type SpendLedger = Pick<Db, "spentToday" | "spentTotal" | "recordSpend">;

/** USD per 1M tokens (input / output). Cache read 0.1x input, cache write 1.25x input, batch 0.5x all. */
export const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;
const BATCH_MULT = 0.5;
const DEFAULT_MAX_TOKENS = 16000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/**
 * The SDK refuses non-streaming requests whose max_tokens implies more than 10 minutes
 * (3600s * max_tokens / 128000 > 600s, i.e. max_tokens > 21333). Above this we stream.
 */
export const MAX_NONSTREAMING_TOKENS = 20000;

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * PBZ attempt 22: the Anthropic account ran out of credit ("400 invalid_request_error: Your credit balance is too low
 * to access the Anthropic API"). The SDK never retries a 400; every further call fails the same way, so a run stops at
 * the first one instead of trying page after page.
 */
export function isOutOfCredit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; message?: unknown; error?: { error?: { message?: unknown } } };
  const text = [e.message, e.error?.error?.message].filter((m): m is string => typeof m === "string").join(" ");
  return e.status === 400 && /credit balance is too low/i.test(text);
}

export class BudgetExceededError extends Error {
  constructor(
    readonly bucket: SpendBucket,
    readonly spent: number,
    readonly limit: number,
  ) {
    super(`Budget exceeded for ${bucket}: spent $${spent.toFixed(4)} of $${limit}`);
    this.name = "BudgetExceededError";
  }
}

export class RefusalError extends Error {
  constructor(
    readonly purpose: string,
    readonly model: string,
  ) {
    super(`Model ${model} refused the request (${purpose})`);
    this.name = "RefusalError";
  }
}

/** Exact id, or a dated id such as `claude-opus-5-5-20261001`. */
function priceFor(model: string): { in: number; out: number } | undefined {
  const exact = PRICES[model];
  if (exact) return exact;
  const key = Object.keys(PRICES).find((k) => model.startsWith(`${k}-`));
  return key ? PRICES[key] : undefined;
}

function requirePrice(model: string): { in: number; out: number } {
  const price = priceFor(model);
  if (!price) throw new Error(`No price configured for model "${model}"`);
  return price;
}

export function costUsd(model: string, usage: UsageLike, batch = false): number {
  const p = requirePrice(model);
  const input =
    usage.input_tokens * p.in +
    (usage.cache_read_input_tokens ?? 0) * p.in * CACHE_READ_MULT +
    (usage.cache_creation_input_tokens ?? 0) * p.in * CACHE_WRITE_MULT;
  const output = usage.output_tokens * p.out;
  return ((input + output) / 1e6) * (batch ? BATCH_MULT : 1);
}

/** `output_config.effort`, as the SDK takes it (xhigh and max above high). */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface StructuredOpts<T> {
  bucket: SpendBucket;
  purpose: string;
  model: string;
  effort: Effort;
  /** Sent as a single text block with `cache_control: { type: "ephemeral" }`. */
  system: string;
  user: string;
  /** Optional images sent before the user text (vision). The news robot never sets this. */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: Buffer }[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Force (true) or forbid (false) streaming; default: stream when maxTokens exceeds the SDK's non-streaming limit. */
  stream?: boolean;
  /** Live writer calls: use the server-side fallback beta with `fallbacks: "default"`. */
  fallbacks?: boolean;
}

export type BatchRequestOpts<T> = Omit<StructuredOpts<T>, "bucket" | "fallbacks"> & { customId: string };

export interface Ai {
  structured<T>(opts: StructuredOpts<T>): Promise<T>;
  /** Builds one Batches API request (no `fallbacks`: the Batches API rejects it). */
  batchRequest<T>(opts: BatchRequestOpts<T>): Anthropic.Messages.Batches.BatchCreateParams.Request;
  /** Records a batch result's usage in the backfill bucket at batch prices. */
  recordBatchUsage(model: string, usage: UsageLike, purpose: string): void;
  /** Throws BudgetExceededError when the bucket's budget is used up. */
  assertBudget(bucket: SpendBucket): void;
}

const systemBlocks = (system: string) => [
  { type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } },
];

const userMessages = (user: string, images?: StructuredOpts<unknown>["images"]) => [
  {
    role: "user" as const,
    content: images?.length
      ? [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.data.toString("base64") },
          })),
          { type: "text" as const, text: user },
        ]
      : user,
  },
];

export function createAi(deps: { client: Anthropic; db: SpendLedger; config: Pick<Config, "DAILY_BUDGET_USD" | "BACKFILL_BUDGET_USD">; now?: () => Date }): Ai {
  const { client, db, config } = deps;
  const now = deps.now ?? (() => new Date());

  function assertBudget(bucket: SpendBucket): void {
    if (bucket === "live") {
      const spent = db.spentToday("live", now());
      if (spent >= config.DAILY_BUDGET_USD) throw new BudgetExceededError("live", spent, config.DAILY_BUDGET_USD);
    } else {
      const spent = db.spentTotal("backfill");
      if (spent >= config.BACKFILL_BUDGET_USD) {
        throw new BudgetExceededError("backfill", spent, config.BACKFILL_BUDGET_USD);
      }
    }
  }

  async function structured<T>(opts: StructuredOpts<T>): Promise<T> {
    assertBudget(opts.bucket);
    requirePrice(opts.model); // fail before spending money on a model we cannot account for

    // The SDK runs `format.parse` on every text block while building the response and throws on
    // invalid JSON. A refusal or a truncated reply would then throw before we could check
    // `stop_reason` or record usage, so parse errors are captured here and rethrown afterwards.
    const base = zodOutputFormat(opts.schema);
    let parseError: unknown;
    const format = {
      type: base.type,
      schema: base.schema,
      parse: (text: string): T | null => {
        try {
          return base.parse(text);
        } catch (err) {
          parseError ??= err;
          return null;
        }
      },
    };

    const common = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: systemBlocks(opts.system),
      messages: userMessages(opts.user, opts.images),
      output_config: { effort: opts.effort, format },
    };

    const stream = opts.stream ?? common.max_tokens > MAX_NONSTREAMING_TOKENS;
    const res = opts.fallbacks
      ? stream
        ? await client.beta.messages
            .stream({ ...common, betas: [FALLBACK_BETA], fallbacks: "default" })
            .finalMessage()
        : await client.beta.messages.parse({ ...common, betas: [FALLBACK_BETA], fallbacks: "default" })
      : stream
        ? await client.messages.stream(common).finalMessage()
        : await client.messages.parse(common);

    // Price by the model that answered (it may be a server-side fallback) when we know its price.
    const pricedModel = priceFor(res.model) ? res.model : opts.model;
    db.recordSpend(opts.bucket, opts.purpose, pricedModel, costUsd(pricedModel, res.usage), now());

    if (res.stop_reason === "refusal") throw new RefusalError(opts.purpose, res.model);

    if (res.parsed_output === null) {
      const detail = parseError instanceof Error ? `: ${parseError.message}` : "";
      throw new Error(
        `No structured output for ${opts.purpose} (stop_reason ${String(res.stop_reason)})${detail}`,
        { cause: parseError },
      );
    }
    return res.parsed_output;
  }

  function batchRequest<T>(opts: BatchRequestOpts<T>): Anthropic.Messages.Batches.BatchCreateParams.Request {
    const { type, schema } = zodOutputFormat(opts.schema);
    return {
      custom_id: opts.customId,
      params: {
        model: opts.model,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: systemBlocks(opts.system),
        messages: userMessages(opts.user),
        // Plain JSON format (no `parse` function) so the request serializes cleanly.
        output_config: { effort: opts.effort, format: { type, schema } },
      },
    };
  }

  function recordBatchUsage(model: string, usage: UsageLike, purpose: string): void {
    db.recordSpend("backfill", purpose, model, costUsd(model, usage, true), now());
  }

  return { structured, batchRequest, recordBatchUsage, assertBudget };
}
