import { isCollapsed } from "@/lib/engine/social";

/**
 * Threaded replies (Plano 4, F9): a comment (or forum post) can be answered, and the answers
 * answered again — 2 levels of replies at most. Answering a 2nd-level reply adds a sibling under
 * the same 1st-level reply (the composer starts with "@autor ", so the conversation stays readable).
 */
export const MAX_REPLY_DEPTH = 2;

/**
 * The parent a new reply is attached to: the item itself when it is a root (depth 0) or a
 * 1st-level reply, and its own parent when it is already a 2nd-level reply.
 * `chain` is the replied item's parent ids from the item up: [item.parentId, grandparentId].
 */
export function replyParentId(itemId: string, itemParentId: string | null, grandparentId: string | null): string {
  if (itemParentId === null) return itemId; // root -> reply at depth 1
  if (grandparentId === null) return itemId; // depth 1 -> reply at depth 2
  return itemParentId; // depth 2 -> sibling at depth 2
}

export type TreeItem = { id: string; parentId: string | null };

export type TreeNode<T extends TreeItem> = T & { depth: number; replies: TreeNode<T>[] };

/**
 * Builds the reply tree of a flat list (kept in the given order inside each level). Items whose
 * parent is not in the list (hidden or removed) are dropped with their replies, and nothing goes
 * deeper than MAX_REPLY_DEPTH.
 */
export function buildTree<T extends TreeItem>(items: T[], rootIds?: string[]): TreeNode<T>[] {
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const grow = (item: T, depth: number): TreeNode<T> => ({
    ...item,
    depth,
    replies: depth >= MAX_REPLY_DEPTH ? [] : (children.get(item.id) ?? []).map((c) => grow(c, depth + 1)),
  });
  const roots = rootIds
    ? rootIds.flatMap((id) => {
        const item = items.find((i) => i.id === id);
        return item ? [item] : [];
      })
    : (children.get(null) ?? []);
  return roots.map((r) => grow(r, 0));
}

export type Collapsible = { likeCount: number; dislikeCount: number };

/** Shown collapsed ("ver mesmo assim"). */
export const collapsed = (item: Collapsible) => isCollapsed(item.likeCount, item.dislikeCount);
