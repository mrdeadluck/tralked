"use client";

import { announceReward } from "@/components/fx/reward-bus";
import { useState, useTransition, type ReactNode } from "react";
import { postComment } from "@/lib/community/actions";
import type { CommentTargetType, CommentThreadView, CommentView } from "@/lib/community/comments";
import { loadReplies } from "@/lib/community/engagement-actions";
import { plural } from "@/lib/community/format";
import type { MyReaction } from "@/lib/community/reaction-rules";
import type { Viewer } from "@/lib/community/viewer";
import { TextComposer } from "./TextComposer";

/** Replies shown while a long list is collapsed (the server sends this many with each comment). */
const COLLAPSED = 3;

export type CommentHandlers = {
  /** The viewer's reaction to this comment. */
  mine: MyReaction;
  /** Opens the reply box answering this comment; absent for logged-out visitors. */
  onReply?: () => void;
  onChanged: (comment: CommentView) => void;
  onDeleted: () => void;
  /** Removed by a moderator (placeholder "Comentário removido pela moderação"). */
  onRemoved: () => void;
  /** Pin / unpin: top-level comments only. */
  onPinned?: (pinned: boolean) => void;
  /** Rendered at the end of the comment (a top-level comment's replies). */
  children?: ReactNode;
  reply: boolean;
};

type CommentThreadProps = {
  root: CommentThreadView;
  targetType: CommentTargetType;
  targetId: string;
  viewer: Viewer;
  /** The moderation locked the discussion: no "Responder" and no reply box. */
  locked: boolean;
  /** The viewer's reactions, by comment id. */
  mine: Record<string, 1 | -1>;
  /** Renders one comment (CommentsClient's CommentItem). */
  renderComment: (comment: CommentView, handlers: CommentHandlers) => ReactNode;
  /** +1 when a reply is posted, -1 when one is deleted (the section's comment total). */
  onTotalChange: (delta: number) => void;
  /** The top-level comment was deleted or removed (it stays as a placeholder, unpinned). */
  onRootGone: () => void;
  /** The top-level comment was pinned or unpinned (the list moves it). */
  onPinned: (pinned: boolean) => void;
};

/**
 * A top-level comment and its replies (one level: answering a reply adds to the same list, with
 * an @mention). Long lists collapse to the first replies; the rest load on demand.
 */
export function CommentThread({
  root: initialRoot,
  targetType,
  targetId,
  viewer,
  locked,
  mine: initialMine,
  renderComment,
  onTotalChange,
  onRootGone,
  onPinned,
}: CommentThreadProps) {
  // The list owns the pinned flag (pinning one comment unpins the others).
  const pinned = initialRoot.pinned;
  const [root, setRoot] = useState<CommentView>(initialRoot);
  const [replies, setReplies] = useState<CommentView[]>(initialRoot.replies);
  const [replyCount, setReplyCount] = useState(initialRoot.replyCount);
  const [mine, setMine] = useState(initialMine);
  const [expanded, setExpanded] = useState(false);
  const [answering, setAnswering] = useState<CommentView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const allLoaded = replies.length >= replyCount;
  const shown = expanded ? replies : replies.slice(0, COLLAPSED);
  const hidden = replyCount - shown.length;

  function expand() {
    if (allLoaded) {
      setExpanded(true);
      return;
    }
    startLoading(async () => {
      const result = await loadReplies({ commentId: root.id });
      if (result.status !== "ok") {
        setLoadError(result.message);
        return;
      }
      setLoadError(null);
      // Keep replies posted meanwhile that the list does not have yet.
      setReplies((list) => [...result.replies, ...list.filter((r) => !result.replies.some((x) => x.id === r.id))]);
      setReplyCount((n) => Math.max(n, result.replies.length));
      setMine((m) => ({ ...m, ...result.mine }));
      setExpanded(true);
    });
  }

  async function submitReply(body: string) {
    if (!answering) return null;
    const result = await postComment({ targetType, targetId, body, parentId: answering.id });
    if (result.status !== "ok") return result.message;
    announceReward(result.reward);
    setReplies((list) => [...list, result.comment]);
    setReplyCount((n) => n + 1);
    // The new reply is at the end: show the whole list so it is on screen.
    if (replies.length + 1 > COLLAPSED) setExpanded(true);
    setAnswering(null);
    onTotalChange(1);
    return null;
  }

  const canReply = viewer !== null && !locked;
  const gone = (comment: CommentView, how: "deleted" | "removed"): CommentView => ({
    ...comment,
    [how]: true,
    pinned: false,
    body: "",
    author: null,
    editedAt: null,
    replyTo: null,
  });

  const reply = (comment: CommentView) =>
    renderComment(comment, {
      mine: mine[comment.id] ?? 0,
      onReply: canReply ? () => setAnswering(comment) : undefined,
      onChanged: (updated) => setReplies((list) => list.map((r) => (r.id === updated.id ? updated : r))),
      onDeleted: () => {
        setReplies((list) => list.map((r) => (r.id === comment.id ? gone(r, "deleted") : r)));
        onTotalChange(-1);
      },
      onRemoved: () => {
        setReplies((list) => list.map((r) => (r.id === comment.id ? gone(r, "removed") : r)));
        onTotalChange(-1);
      },
      reply: true,
    });

  const showBlock = replyCount > 0 || (answering !== null && !locked);
  const block = showBlock ? (
    <div className="mt-1 flex flex-col gap-2 border-l-2 border-line pl-4 min-[560px]:ml-[38px]">
      {replyCount > 0 ? (
        <p className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase">
          {plural(replyCount, "resposta", "respostas")}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul
          aria-label={`Respostas ao comentário de ${root.author ? `@${root.author.handle}` : "conta removida"}`}
          className="m-0 flex list-none flex-col p-0"
        >
          {shown.map(reply)}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <button type="button" onClick={expand} disabled={loading} aria-expanded={false} className={TOGGLE}>
          {loading ? "Carregando…" : `Ver mais ${plural(hidden, "resposta", "respostas")}`}
        </button>
      ) : expanded && replies.length > COLLAPSED ? (
        <button type="button" onClick={() => setExpanded(false)} aria-expanded className={TOGGLE}>
          Recolher respostas
        </button>
      ) : null}
      {loadError ? (
        <p role="alert" className="text-[13px] text-nin">
          {loadError}
        </p>
      ) : null}
      {answering && !locked ? (
        <TextComposer
          key={answering.id}
          label={answering.author ? `Responder a @${answering.author.handle}` : "Responder"}
          placeholder={answering.author ? `Responder a @${answering.author.handle}…` : "Sua resposta…"}
          submitLabel="Responder"
          rows={2}
          autoFocus
          onSubmit={submitReply}
          onCancel={() => setAnswering(null)}
        />
      ) : null}
    </div>
  ) : null;

  return renderComment(
    { ...root, pinned: pinned && !root.deleted && !root.removed },
    {
      mine: mine[root.id] ?? 0,
      onReply: canReply ? () => setAnswering(root) : undefined,
      onChanged: (updated) => setRoot(updated),
      onDeleted: () => {
        setRoot((c) => gone(c, "deleted"));
        onRootGone();
      },
      onRemoved: () => {
        setRoot((c) => gone(c, "removed"));
        onRootGone();
      },
      onPinned,
      children: block,
      reply: false,
    },
  );
}

const TOGGLE =
  "min-h-6 cursor-pointer self-start font-mono text-xs tracking-[0.06em] text-acc uppercase hover:underline hover:underline-offset-4 disabled:cursor-wait disabled:opacity-60";
