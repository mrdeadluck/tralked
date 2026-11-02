"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { loginHref } from "@/components/guide/format";
import { loadMoreComments, postComment, removeComment, updateComment } from "@/lib/community/actions";
import type { CommentPage, CommentTargetType, CommentView } from "@/lib/community/comments";
import { formatWhen, plural } from "@/lib/community/format";
import type { MyReaction } from "@/lib/community/reaction-rules";
import { REACTION_GIVEN_XP } from "@/lib/community/rewards";
import type { Viewer } from "@/lib/community/viewer";
import { CommentModActions } from "@/components/moderation/CommentModActions";
import { DiscussionLockToggle, LockedNotice } from "@/components/moderation/DiscussionLock";
import { AuthorBadge } from "./AuthorBadge";
import { CommentThread } from "./CommentThread";
import { ReactionButtons } from "./ReactionButtons";
import { ReplyIcon } from "./reaction-icons";
import { ReportButton } from "./ReportButton";
import { TextComposer } from "./TextComposer";
import { UserText } from "./UserText";

/** Comments whose first reaction still pays the viewer XP (shared with every CommentItem). */
const XpOpenContext = createContext<ReadonlySet<string>>(new Set());

type CommentsClientProps = {
  targetType: CommentTargetType;
  targetId: string;
  initial: CommentPage;
  viewer: Viewer;
  returnTo: string;
  /** The moderation locked the discussion: no comment box. */
  locked?: boolean;
};

export function CommentsClient({ targetType, targetId, initial, viewer, returnTo, locked: initialLocked = false }: CommentsClientProps) {
  const [comments, setComments] = useState(initial.comments);
  const [locked, setLocked] = useState(initialLocked);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [total, setTotal] = useState(initial.total);
  const [mine, setMine] = useState(initial.mine ?? {});
  const [xpOpen, setXpOpen] = useState<ReadonlySet<string>>(() => new Set(initial.xpOpen ?? []));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  async function submit(body: string) {
    const result = await postComment({ targetType, targetId, body });
    if (result.status !== "ok") return result.message;
    setComments((list) => [{ ...result.comment, replies: [], replyCount: 0 }, ...list]);
    setTotal((n) => n + 1);
    return null;
  }

  function loadMore() {
    if (!cursor) return;
    startLoading(async () => {
      const result = await loadMoreComments({ targetType, targetId, cursor });
      if ("status" in result) {
        setLoadError(result.message);
        return;
      }
      setLoadError(null);
      setComments((list) => [...list, ...result.comments.filter((c) => !list.some((x) => x.id === c.id))]);
      setMine((m) => ({ ...m, ...result.mine }));
      setXpOpen((open) => new Set([...open, ...(result.xpOpen ?? [])]));
      setCursor(result.nextCursor);
    });
  }

  /** Pinning moves the comment to the top and unpins the previous one (one per discussion). */
  function setPinned(id: string, pinned: boolean) {
    setComments((list) => {
      const next = list.map((c) => (c.id === id ? { ...c, pinned } : pinned ? { ...c, pinned: false } : c));
      if (!pinned) return next;
      const target = next.find((c) => c.id === id);
      return target ? [target, ...next.filter((c) => c.id !== id)] : next;
    });
  }

  return (
    <XpOpenContext value={xpOpen}>
    <div className="flex flex-col gap-5">
      {viewer?.moderator ? (
        <div className="flex justify-end">
          <DiscussionLockToggle targetType={targetType} targetId={targetId} locked={locked} onChange={setLocked} />
        </div>
      ) : null}
      {locked ? (
        <LockedNotice />
      ) : viewer ? (
        <TextComposer
          label="Escreva um comentário"
          placeholder="O que você achou?"
          submitLabel="Comentar"
          onSubmit={submit}
        />
      ) : (
        <p className="rounded-[4px] border border-line bg-surface px-4 py-3.5 text-[15px] text-muted">
          <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
            Entre na sua conta
          </a>{" "}
          para comentar.
        </p>
      )}

      <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase" aria-live="polite">
        {total === 0 ? "Nenhum comentário ainda" : plural(total, "comentário", "comentários")}
      </p>

      {comments.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {comments.map((comment) => (
            <CommentThread
              key={comment.id}
              root={comment}
              targetType={targetType}
              targetId={targetId}
              viewer={viewer}
              locked={locked}
              mine={mine}
              onTotalChange={(delta) => setTotal((n) => Math.max(0, n + delta))}
              onRootGone={() => {
                // Deleted or removed: it stays as a placeholder (with its replies) and is unpinned.
                setComments((list) => list.map((c) => (c.id === comment.id ? { ...c, pinned: false } : c)));
                setTotal((n) => Math.max(0, n - 1));
              }}
              onPinned={(pinned) => setPinned(comment.id, pinned)}
              renderComment={(item, handlers) => (
                <CommentItem
                  key={item.id}
                  comment={item}
                  viewer={viewer}
                  returnTo={returnTo}
                  mine={handlers.mine}
                  reply={handlers.reply}
                  onReply={handlers.onReply}
                  onChanged={handlers.onChanged}
                  onDeleted={handlers.onDeleted}
                  onRemoved={handlers.onRemoved}
                  onPinned={handlers.onPinned}
                >
                  {handlers.children}
                </CommentItem>
              )}
            />
          ))}
        </ul>
      ) : null}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="h-10 cursor-pointer self-start rounded-[2px] border border-line-2 px-4 font-mono text-xs tracking-[0.08em] text-text-3 uppercase hover:border-text hover:text-text disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Carregando…" : "Ver comentários anteriores"}
        </button>
      ) : null}
      {loadError ? (
        <p role="alert" className="text-[13px] text-nin">
          {loadError}
        </p>
      ) : null}
    </div>
    </XpOpenContext>
  );
}

type CommentItemProps = {
  comment: CommentView;
  viewer: Viewer;
  returnTo: string;
  onChanged: (comment: CommentView) => void;
  onDeleted: () => void;
  onRemoved: () => void;
  /** Pin / unpin (top-level comments only: a reply cannot be pinned). */
  onPinned?: (pinned: boolean) => void;
  /** The viewer's like (1) or dislike (-1) on this comment. */
  mine?: MyReaction;
  /** Opens the reply box (logged-in visitors, unlocked discussions only). */
  onReply?: () => void;
  /** A reply inside a thread (tighter spacing). */
  reply?: boolean;
  /** The replies of a top-level comment. */
  children?: ReactNode;
};

function CommentItem({
  comment,
  viewer,
  returnTo,
  onChanged,
  onDeleted,
  onRemoved,
  onPinned,
  mine = 0,
  onReply,
  reply = false,
  children,
}: CommentItemProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const own = viewer !== null && comment.author?.id === viewer.id;
  // Reacting to your own comment pays nothing, so it never promises XP.
  const xpOpen = useContext(XpOpenContext);
  const xpHint = !own && xpOpen.has(comment.id) ? REACTION_GIVEN_XP : undefined;

  async function saveEdit(body: string) {
    const result = await updateComment({ id: comment.id, body });
    if (result.status !== "ok") return result.message;
    onChanged(result.comment);
    setMode("view");
    return null;
  }

  function confirmDelete() {
    startTransition(async () => {
      const result = await removeComment({ id: comment.id });
      if (result.status === "ok" || result.status === "not_found") onDeleted();
      else setError(result.message);
    });
  }

  const itemClass = reply ? "py-3 first:pt-1" : "border-b border-divider py-4 first:pt-0";

  if (comment.deleted || comment.removed) {
    return (
      <li id={`comentario-${comment.id}`} className={`flex flex-col gap-2.5 ${itemClass}`}>
        <p className="font-mono text-[12px] text-dim italic">
          {comment.removed ? "Comentário removido pela moderação" : "Comentário apagado"}
        </p>
        {children}
      </li>
    );
  }
  const what = `comentário de ${comment.author ? `@${comment.author.handle}` : "conta removida"}`;

  return (
    <li id={`comentario-${comment.id}`} className={`flex scroll-mt-24 flex-col gap-2.5 ${itemClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-center gap-3">
          <AuthorBadge author={comment.author} size={28} />
          {comment.pinned ? (
            <span className="rounded-[2px] border border-acc px-1.5 py-0.5 font-mono text-xs leading-none tracking-[0.08em] text-acc uppercase">
              Fixado
            </span>
          ) : null}
        </span>
        <time dateTime={new Date(comment.createdAt).toISOString()} className="font-mono text-xs text-dim">
          {formatWhen(comment.createdAt, true)}
          {comment.editedAt ? " · editado" : ""}
        </time>
      </div>

      {mode === "edit" ? (
        <TextComposer
          label="Editar comentário"
          initialValue={comment.body}
          submitLabel="Salvar"
          onSubmit={saveEdit}
          onCancel={() => setMode("view")}
        />
      ) : (
        <ReplyBody comment={comment} />
      )}

      {mode === "view" ? (
        <div className="flex flex-wrap items-start gap-4">
          <ReactionButtons
            targetType="comment"
            targetId={comment.id}
            likes={comment.likes}
            dislikes={comment.dislikes}
            mine={mine}
            loggedIn={viewer !== null}
            returnTo={returnTo}
            size="sm"
            what={`o ${what}`}
            xpHint={xpHint}
          />
          {onReply ? (
            <button type="button" onClick={onReply} className={`${ACTION} inline-flex min-h-6 items-center gap-1.5`}>
              <ReplyIcon width={14} height={14} />
              Responder
            </button>
          ) : null}
          {own ? (
            <>
              <button type="button" onClick={() => setMode("edit")} className={ACTION}>
                Editar
              </button>
              <button type="button" onClick={() => setMode("confirm-delete")} className={ACTION}>
                Apagar
              </button>
            </>
          ) : viewer?.moderator ? null : (
            <ReportButton targetType="comment" targetId={comment.id} loggedIn={viewer !== null} returnTo={returnTo} what={what} />
          )}
          {viewer?.moderator ? (
            <CommentModActions commentId={comment.id} pinned={comment.pinned} what={what} onRemoved={onRemoved} onPinned={onPinned} />
          ) : null}
        </div>
      ) : null}

      {mode === "confirm-delete" ? (
        <div role="group" aria-label="Confirmar exclusão" className="flex flex-wrap items-center gap-3 text-[14px]">
          <span className="text-text-2">Apagar este comentário de vez?</span>
          <button type="button" onClick={confirmDelete} disabled={busy} className={DANGER}>
            {busy ? "Apagando…" : "Sim, apagar"}
          </button>
          <button type="button" onClick={() => setMode("view")} className={ACTION}>
            Manter
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-nin">
          {error}
        </p>
      ) : null}
      {children}
    </li>
  );
}

/** The comment text; a reply to a reply starts with the @mention of the person answered. */
function ReplyBody({ comment }: { comment: CommentView }) {
  const text = <UserText text={comment.body} className="text-[15.5px] leading-relaxed text-text-2" />;
  if (!comment.replyTo) return text;
  const handle = comment.replyTo.handle;
  return (
    <div className="flex flex-col gap-1">
      <a
        href={`/jogador/${encodeURIComponent(handle)}`}
        className="self-start font-mono text-[12px] text-acc hover:underline hover:underline-offset-2"
      >
        <span className="sr-only">Em resposta a </span>@{handle}
      </a>
      {text}
    </div>
  );
}

const ACTION_BASE =
  "cursor-pointer font-mono text-xs tracking-[0.06em] uppercase disabled:cursor-wait disabled:opacity-60";
const ACTION = `${ACTION_BASE} text-dim hover:text-text`;
const DANGER = `${ACTION_BASE} text-nin hover:underline`;
