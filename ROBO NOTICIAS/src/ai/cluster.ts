import { z } from "zod";
import type { Db, SpendBucket } from "../db.js";
import type { Ai } from "./client.js";
import { DEFAULT_FAST_MODEL, type Triage } from "./triage.js";

export const CLUSTER_CHUNK = 40;
/** Stories whose last item is at most this old are open for clustering. */
export const OPEN_STORY_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_TOKENS = 16000;

export interface ClusterItem {
  id: number;
  headlinePt: string;
  games: string[];
}

export interface OpenStory {
  key: string;
  headline: string;
  games: string[];
}

/**
 * `storyKey: null` means the item starts a new story, whose key is `newStoryKey(id)` and whose headline is
 * `newHeadline`. Later items of that same new story carry `newStoryKey(id)` as their `storyKey`; results are
 * in input order and a new story's first item always comes before the others.
 */
export interface ClusterResult {
  id: number;
  storyKey: string | null;
  newHeadline?: string;
}

/** Key of the story started by item `itemId` (item ids are unique, so the key is too). */
export const newStoryKey = (itemId: number): string => `item-${itemId}`;

/** The story key an item ends up in, whether it joined an existing story or started a new one. */
export const storyKeyOf = (r: ClusterResult): string => r.storyKey ?? newStoryKey(r.id);

/** Kept triaged items, shaped for `clusterItems`; dropped items never reach clustering. */
export function clusterInputs(triages: Triage[]): ClusterItem[] {
  return triages.filter((t) => t.keep).map((t) => ({ id: t.id, headlinePt: t.headlinePt, games: t.games }));
}

/** Stories (any status) whose `last_item_at` is within the last 72 h of `now`, most recent first. */
export function openStories(db: Db, now: Date): OpenStory[] {
  const nowMs = now.getTime();
  // Coarse SQL window (one day of slack for non-UTC ISO strings), then an exact check on parsed dates.
  const pad = 24 * 60 * 60 * 1000;
  const rows = db.raw
    .prepare("SELECT key, headline, games_json, last_item_at FROM stories WHERE last_item_at >= ? AND last_item_at <= ?")
    .all(new Date(nowMs - OPEN_STORY_WINDOW_MS - pad).toISOString(), new Date(nowMs + pad).toISOString()) as unknown as {
    key: string;
    headline: string;
    games_json: string;
    last_item_at: string;
  }[];
  return rows
    .map((r) => ({ r, at: Date.parse(r.last_item_at) }))
    .filter(({ at }) => at <= nowMs && nowMs - at <= OPEN_STORY_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .map(({ r }) => ({ key: r.key, headline: r.headline, games: parseGames(r.games_json) }));
}

function parseGames(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

const ClusterResponse = z.object({
  groups: z.array(
    z.object({
      storyKey: z.string().nullable(),
      headline: z.string().nullable(),
      itemIds: z.array(z.number().int()),
    }),
  ),
});

/** Fixed (cache-friendly): no dates or other volatile content. */
export const CLUSTER_SYSTEM = `You are the clustering editor of Tralked, a Brazilian video game news site.

You receive a JSON list of open stories (each with a key, a headline and its games) and a JSON list of new news items (each with an id, a headline in Brazilian Portuguese and its games).

Group the new items by the fact they report. Two items belong to the same story only when they report the same fact: the same announcement, event, release, leak or development. Items that merely mention the same game or company but report different facts are different stories (e.g. "GTA 6 gets a new trailer" and "GTA 6 is delayed" are two stories).

Return a list of groups. Each group has:
- storyKey: the key of the open story the items report, copied exactly, or null when the items report a fact that no open story covers.
- headline: when storyKey is null, a short factual headline in Brazilian Portuguese for the new story; otherwise null.
- itemIds: the ids of the new items in the group.

Every new item id must appear in exactly one group. Put items reporting the same new fact in the same group. Prefer an existing open story whenever it reports the same fact.`;

function userMessage(items: ClusterItem[], open: OpenStory[]): string {
  return `Open stories:\n${JSON.stringify(open)}\n\nNew items:\n${JSON.stringify(items)}`;
}

/**
 * Assigns new items to open stories or to new stories, in chunks of `chunkSize` items, sequentially (the
 * budget check does not reserve spend, so parallel calls could overshoot it). Stories started by one chunk
 * are open for the following chunks. A story key the model invents is treated as a new story, and items
 * the model leaves out become stories of their own.
 */
export async function clusterItems(
  ai: Ai,
  newItems: ClusterItem[],
  openStoriesIn: OpenStory[],
  bucket: SpendBucket,
  opts: { model?: string; chunkSize?: number } = {},
): Promise<ClusterResult[]> {
  const model = opts.model ?? DEFAULT_FAST_MODEL;
  const chunkSize = Math.max(1, opts.chunkSize ?? CLUSTER_CHUNK);
  const open = [...openStoriesIn];
  const known = new Set(open.map((s) => s.key));
  const out: ClusterResult[] = [];

  for (let i = 0; i < newItems.length; i += chunkSize) {
    const chunk = newItems.slice(i, i + chunkSize);
    const res = await ai.structured({
      bucket,
      purpose: "cluster",
      model,
      effort: "low",
      system: CLUSTER_SYSTEM,
      user: userMessage(chunk, open),
      schema: ClusterResponse,
      maxTokens: MAX_TOKENS,
    });

    const order = new Map(chunk.map((it, idx) => [it.id, idx]));
    const byId = new Map(chunk.map((it) => [it.id, it]));
    const assigned = new Map<number, ClusterResult>();

    const startStory = (ids: number[], headline: string | null) => {
      const founder = byId.get(ids[0]!)!;
      const key = newStoryKey(founder.id);
      const newHeadline = headline?.trim() || founder.headlinePt;
      assigned.set(founder.id, { id: founder.id, storyKey: null, newHeadline });
      for (const id of ids.slice(1)) assigned.set(id, { id, storyKey: key });
      const games = [...new Set(ids.flatMap((id) => byId.get(id)!.games))];
      open.push({ key, headline: newHeadline, games });
      known.add(key);
    };

    for (const g of res.groups) {
      // Only this chunk's ids, each once (first group wins), in input order so the founder comes first.
      const ids = [...new Set(g.itemIds)]
        .filter((id) => order.has(id) && !assigned.has(id))
        .sort((a, b) => order.get(a)! - order.get(b)!);
      if (ids.length === 0) continue;
      if (g.storyKey !== null && known.has(g.storyKey)) {
        for (const id of ids) assigned.set(id, { id, storyKey: g.storyKey });
      } else {
        startStory(ids, g.headline);
      }
    }
    for (const it of chunk) {
      if (!assigned.has(it.id)) startStory([it.id], null);
    }
    for (const it of chunk) out.push(assigned.get(it.id)!);
  }
  return out;
}
