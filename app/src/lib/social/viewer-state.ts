import type { Db } from "@/lib/community/limits";
import type { SocialItemKind } from "@/lib/engine/social";
import { viewerReactions } from "./reactions";
import { blockedEitherWay } from "./relations";
import { EMPTY_VIEWER_STATE, type SocialViewerState } from "./types";

export type { SocialViewerState };

type WithReplies = { id: string; author: { id: string } | null; replies?: WithReplies[] };

function flatten(items: WithReplies[]): WithReplies[] {
  return items.flatMap((i) => [i, ...flatten(i.replies ?? [])]);
}

/** Per-visitor state of comments (with their nested replies) or posts. Read per request, never cached. */
export async function socialViewerState(
  db: Db,
  viewerId: string | null,
  kind: SocialItemKind,
  items: WithReplies[],
): Promise<SocialViewerState> {
  if (!viewerId) return EMPTY_VIEWER_STATE;
  const all = flatten(items);
  const [mine, blocked] = await Promise.all([
    viewerReactions(
      db,
      viewerId,
      kind,
      all.map((i) => i.id),
    ),
    blockedEitherWay(db, viewerId),
  ]);
  const authors = new Set(all.flatMap((i) => (i.author ? [i.author.id] : [])));
  return { mine, blocked: [...blocked].filter((id) => authors.has(id)) };
}
