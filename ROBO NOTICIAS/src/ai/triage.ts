import { z } from "zod";
import type { Source } from "../config.js";
import type { SpendBucket } from "../db.js";
import type { Ai } from "./client.js";

export const TRIAGE_CHUNK = 50;
/** Same default as `config.MODEL_FAST`; callers should pass `config.MODEL_FAST`. */
export const DEFAULT_FAST_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 16000;
const SUMMARY_MAX_CHARS = 600;

export const CATEGORIES = ["GAMES", "MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Triage = {
  id: number;
  keep: boolean;
  category: Category;
  games: string[];
  companies: string[];
  rumor: boolean;
  /** 0-100 */
  importance: number;
  headlinePt: string;
};

export interface TriageInput {
  id: number;
  title: string;
  summary: string | null;
  source: Source;
}

// Plain numbers on purpose: a bound the model overshoots would fail the whole chunk; we clamp instead.
const TriageResponse = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      keep: z.boolean(),
      category: z.enum(CATEGORIES),
      games: z.array(z.string()),
      companies: z.array(z.string()),
      rumor: z.boolean(),
      importance: z.number(),
      headlinePt: z.string(),
    }),
  ),
});

/** Fixed (cache-friendly): no dates or other volatile content. */
export const TRIAGE_SYSTEM = `You are the triage editor of Tralked, a Brazilian video game news site written in Brazilian Portuguese for a Brazilian gamer audience.

You receive a JSON list of news items collected from RSS feeds and news pages. Each item has an id, the source name, the source tier (oficial = the publisher or platform itself, portal = an established news outlet, outro = anything else), a gamingFilter flag, a title and sometimes a summary. Titles and summaries may be in English or Portuguese.

Return exactly one entry per input item, with the same id:
- keep: whether the item is worth covering as news on a gaming site.
- category: GAMES (games, consoles as gaming platforms, updates, trailers, releases, esports), MERCADO (industry business: sales figures, earnings, acquisitions, layoffs, studio closures, pricing policy), ENTRETENIMENTO (films, series, anime and other media, including game adaptations), TECNOLOGIA (hardware and technology: GPUs, PCs, chips, AI, gadgets).
- games: official names of the video games the item is about (e.g. "Grand Theft Auto VI"). Empty when none.
- companies: companies the item is about (publishers, studios, platform holders, manufacturers). Empty when none.
- rumor: true when the item reports a leak, rumor, insider claim, speculation or anything not officially confirmed.
- importance: an integer from 0 to 100 measuring how interesting the story is for a Brazilian gamer audience.
- headlinePt: a short, factual headline in Brazilian Portuguese stating the fact (no clickbait, no emojis, no source name).

Set keep to false for:
- deals, sales, discounts, price drops, promo codes, coupons and giveaways;
- listicles and rankings ("top 10", "best games of", "X games like Y");
- reviews of products that are not games (headphones, phones, TVs, chairs, gadgets and similar);
- sponsored content, advertorials, paid partnerships and affiliate posts;
- when the item's gamingFilter flag is true: anything not about games (general technology, phones, politics, celebrity news, general entertainment unrelated to games).
Otherwise keep news that interests gamers.

How to score importance:
- 90-100: huge news about mega-franchises or the main platforms (e.g. a GTA 6 trailer, release date or delay; a new PlayStation, Xbox or Nintendo console announcement). Mega-franchises such as GTA 6 score highest.
- 70-89: major news about big franchises, big publishers or the platforms (major reveals, release dates, big showcases, big acquisitions).
- 40-69: regular news (updates, trailers of mid-size games, ordinary industry news).
- 0-39: minor or niche news.
Raise the score for games and franchises especially popular in Brazil (e.g. Free Fire, EA Sports FC, Counter-Strike, Fortnite, Minecraft, GTA, League of Legends) and for news that directly affects Brazilian players (Brazilian prices, Portuguese localization, Brazilian servers or events). Lower it for rumors from weak sources.`;

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function userMessage(items: TriageInput[]): string {
  const payload = items.map((it) => ({
    id: it.id,
    source: it.source.name,
    tier: it.source.tier,
    gamingFilter: it.source.gamingFilter,
    title: it.title,
    summary: it.summary ? truncate(it.summary, SUMMARY_MAX_CHARS) : null,
  }));
  return `Triage these ${items.length} items:\n${JSON.stringify(payload)}`;
}

const clampImportance = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Triages items in chunks of 50, one fast-model call per chunk, sequentially (the budget check does not
 * reserve spend, so parallel calls could overshoot it). Returns one `Triage` per item the model answered,
 * in input order; ids the model invents or repeats are ignored, and unanswered items are omitted so the
 * caller can retry them later.
 */
export async function triageItems(
  ai: Ai,
  items: TriageInput[],
  bucket: SpendBucket,
  opts: { model?: string } = {},
): Promise<Triage[]> {
  const model = opts.model ?? DEFAULT_FAST_MODEL;
  const out: Triage[] = [];
  for (let i = 0; i < items.length; i += TRIAGE_CHUNK) {
    const chunk = items.slice(i, i + TRIAGE_CHUNK);
    const res = await ai.structured({
      bucket,
      purpose: "triage",
      model,
      effort: "low",
      system: TRIAGE_SYSTEM,
      user: userMessage(chunk),
      schema: TriageResponse,
      maxTokens: MAX_TOKENS,
    });
    const byId = new Map<number, Triage>();
    for (const t of res.items) {
      if (byId.has(t.id)) continue;
      byId.set(t.id, { ...t, importance: clampImportance(t.importance) });
    }
    for (const it of chunk) {
      const t = byId.get(it.id);
      if (t) out.push(t);
    }
  }
  return out;
}
