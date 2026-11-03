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
  /** Must be a model that supports the web search tool (e.g. claude-sonnet-5-5). */
  model: string;
  /** Called once per search with the computed cost (tokens + search requests). */
  recordSpend: (usd: number, purpose: string) => void;
  /** Searches the model may run for one query. Default 1. */
  maxUses?: number;
}

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
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM,
      tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: maxUses }] as never,
      messages: [{ role: "user", content: `Search the web for: ${query}` }],
    });
    const usage = res.usage as {
      input_tokens: number;
      output_tokens: number;
      server_tool_use?: { web_search_requests?: number } | null;
    };
    const searches = usage.server_tool_use?.web_search_requests ?? 0;
    const usd = (usage.input_tokens * priceIn + usage.output_tokens * priceOut) / 1e6 + searches * WEB_SEARCH_USD_PER_REQUEST;
    recordSpend(usd, `websearch: ${query}`.slice(0, 120));
    return extractHits(res.content as Block[]);
  }

  return { search };
}
