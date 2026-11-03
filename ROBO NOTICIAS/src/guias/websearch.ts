import type Anthropic from "@anthropic-ai/sdk";
import { PRICES } from "../ai/client.js";

/** Server-side web search tool (dynamic filtering): Opus 5.5/5, Sonnet 5.5/5 and Sonnet 4.6. Haiku is not supported. */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
/** List price: $10 per 1,000 searches. */
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearch {
  search(query: string): Promise<SearchHit[]>;
}

export interface WebSearchDeps {
  client: Pick<Anthropic, "messages">;
  /** Must be a model that supports the web search tool (claude-sonnet-5-5, or claude-opus-5-5 with MODEL_EXTRACT on Opus). */
  model: string;
  /** Called after every model turn of a search with that turn's cost (tokens + search requests). */
  recordSpend: (usd: number, purpose: string) => void;
  /** Searches the model may run for one query. Default 1. */
  maxUses?: number;
}

const MAX_PAUSED_TURNS = 4;

const SYSTEM =
  "You are a search helper. Run the web search for the user's query and reply with the single word OK. " +
  "Do not summarize or analyze the results.";

type Block = { type: string; content?: unknown };
type RawHit = { type?: string; title?: string; url?: string; page_age?: string | null };

/** Pulls the hits out of the `web_search_tool_result` blocks; an error result (an object, not a list) yields nothing. */
export function extractHits(content: Block[]): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const block of content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content as RawHit[]) {
      if (r.type !== "web_search_result" || !r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      hits.push({ title: r.title ?? r.url, url: r.url, ...(r.page_age ? { snippet: r.page_age } : {}) });
    }
  }
  return hits;
}

export function createWebSearch(deps: WebSearchDeps): WebSearch {
  const { client, model, recordSpend, maxUses = 1 } = deps;
  const price = PRICES[model];
  if (!price) throw new Error(`No price configured for model "${model}"`);
  const { in: priceIn, out: priceOut } = price;

  async function search(query: string): Promise<SearchHit[]> {
    const messages: { role: "user" | "assistant"; content: unknown }[] = [
      { role: "user", content: `Search the web for: ${query}` },
    ];
    const blocks: Block[] = [];
    const purpose = `websearch: ${query}`.slice(0, 120);
    // `pause_turn`: the server-side tool loop hit its iteration limit; send the turn back to continue it. Each
    // turn is recorded as soon as it is paid, so a later turn that throws loses nothing.
    for (let turn = 0; turn < MAX_PAUSED_TURNS; turn++) {
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        system: SYSTEM,
        tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: maxUses }] as never,
        messages: messages as never,
      });
      const usage = res.usage as {
        input_tokens: number;
        output_tokens: number;
        server_tool_use?: { web_search_requests?: number } | null;
      };
      const searches = usage.server_tool_use?.web_search_requests ?? 0;
      recordSpend((usage.input_tokens * priceIn + usage.output_tokens * priceOut) / 1e6 + searches * WEB_SEARCH_USD_PER_REQUEST, purpose);
      blocks.push(...(res.content as Block[]));
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    return extractHits(blocks);
  }

  return { search };
}
