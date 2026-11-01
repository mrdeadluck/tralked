"use client";

import { useState, useTransition } from "react";
import { loginHref } from "@/components/guide/format";
import { Collapsible } from "@/components/social/Collapsible";
import { ReactionBar } from "@/components/social/ReactionBar";
import { loadMoreComments, postComment, removeComment, updateComment } from "@/lib/community/actions";
import type { CommentPage, CommentTargetType, CommentView } from "@/lib/community/comments";
import { formatWhen, plural } from "@/lib/community/format";
import type { Viewer } from "@/lib/community/viewer";
import { COMMENT_HELPFUL_XP, isCollapsed } from "@/lib/engine/social";
import { markHelpfulAction } from "@/lib/social/actions";
import type { SocialViewerState } from "@/lib/social/types";
import { AuthorBadge } from "./AuthorBadge";
import { CheckIcon, ReplyIcon } from "./icons";
import { ReportButton } from "./ReportButton";
import { TextComposer } from "./TextComposer";
import { UserText } from "./UserText";

type CommentsClientProps = {
  targetType: CommentTargetType;
  targetId: string;
  initial: CommentPage;
  viewer: Viewer;
  viewerState: SocialViewerState;
  returnTo: string;
};

/** Applies `fn` to the comment with `id` anywhere in the tree. */
function mapTree(list: CommentView[], id: string, fn: (c: CommentView) => CommentView): CommentView[] {
  return list.map((c) => (c.id === id ? fn(c) : c.replies.length > 0 ? { ...c, replies: mapTree(c.replies, id, fn) } : c));
}

export function CommentsClient({ targetType, targetId, initial, viewer, viewerState, returnTo }: CommentsClientProps) {
  const [comments, setComments] = useState(initial.comments);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [total, setTotal] = useState(initial.total);
  const [state, setState] = useState(viewerState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  async function submit(body: string) {
    const result = await postComment({ targetType, targetId, body });
    if (result.status !== "ok") return result.message;
    setComments((list) => [result.comment, ...list]);
    setTotal((n) => n + 1);
    return null;
  }

  async function reply(parentId: string, body: string) {
    const result = await postComment({ targetType, targetId, body, parentId });
    if (result.status !== "ok") return result.message;
    const added = result.comment;
    setComments((list) => mapTree(list, added.parentId ?? parentId, (c) => ({ ...c, replies: [...c.replies, added] })));
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
      setState((s) => ({
        mine: { ...s.mine, ...result.viewerState.mine },
        blocked: [...new Set([...s.blocked, ...result.viewerState.blocked])],
      }));
      setCursor(result.nextCursor);
    });
  }

  const tree = {
    viewer,
    state,
    returnTo,
    onReply: reply,
    onChanged: (updated: CommentView) =>
      setComments((list) => mapTree(list, updated.id, (c) => ({ ...updated, depth: c.depth, replies: c.replies }))),
    onDeleted: (id: string) => {
      setComments((list) =>
        mapTree(list, id, (c) => ({ ...c, deleted: true, body: "", author: null, editedAt: null, likeCount: 0, dislikeCount: 0 })),
      );
      setTotal((n) => Math.max(0, n - 1));
    },
    onHelpful: (id: string) => setComments((list) => mapTree(list, id, (c) => ({ ...c, helpful: true }))),
  };

  return (
    <div className="flex flex-col gap-5">
      {viewer ? (
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
          para comentar, curtir e responder.
        </p>
      )}

      <p className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase" aria-live="polite">
        {total === 0 ? "Nenhum comentário ainda" : plural(total, "comentário", "comentários")}
      </p>

      {comments.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} parentAuthorId={null} {...tree} />
          ))}
        </ul>
      ) : null}

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="h-10 cursor-pointer self-start rounded-[2px] border border-line-2 px-4 font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase hover:border-text hover:text-text disabled:cursor-wait disabled:opacity-60"
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
  );
}

type CommentItemProps = {
  comment: CommentView;
  /** Author of the comment this one answers (may mark it "Útil"). */
  parentAuthorId: string | null;
  viewer: Viewer;
  state: SocialViewerState;
  returnTo: string;
  onReply: (parentId: string, body: string) => Promise<string | null>;
  onChanged: (comment: CommentView) => void;
  onDeleted: (id: string) => void;
  onHelpful: (id: string) => void;
};

function CommentItem(props: CommentItemProps) {
  const { comment, parentAuthorId, viewer, state, returnTo, onReply, onChanged, onDeleted, onHelpful } = props;
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete" | "reply">("view");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const own = viewer !== null && comment.author?.id === viewer.id;
  const blocked = comment.author !== null && state.blocked.includes(comment.author.id);
  const who = comment.author ? `@${comment.author.handle}` : "conta removida";
  const canMarkHelpful =
    viewer !== null && parentAuthorId === viewer.id && !own && !comment.helpful && !comment.deleted && comment.author !== null;

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
      if (result.status === "ok" || result.status === "not_found") onDeleted(comment.id);
      else setError(result.message);
    });
  }

  function markHelpful() {
    startTransition(async () => {
      const result = await markHelpfulAction({ kind: "comment", id: comment.id });
      if (result.status === "ok") {
        onHelpful(comment.id);
        setNotice(`Marcada como útil. ${who} pode ganhar ${COMMENT_HELPFUL_XP} XP.`);
        setError(null);
      } else setError(result.message);
    });
  }

  async function sendReply(body: string) {
    const message = await onReply(comment.id, body);
    if (message === null) setMode("view");
    return message;
  }

  const replies =
    comment.replies.length > 0 ? (
      <ul aria-label={`Respostas ao comentário de ${who}`} className="m-0 mt-1 flex list-none flex-col border-l-2 border-line pl-4 min-[641px]:pl-5">
        {comment.replies.map((reply) => (
          <CommentItem key={reply.id} {...props} comment={reply} parentAuthorId={comment.author?.id ?? null} />
        ))}
      </ul>
    ) : null;

  if (comment.deleted) {
    return (
      <li id={`comentario-${comment.id}`} className="scroll-mt-24 border-b border-divider py-4 first:pt-0 last:border-b-0">
        <p className="font-mono text-[12px] text-dim italic">Comentário apagado</p>
        {replies}
      </li>
    );
  }

  const body = (
    <>
      {mode === "edit" ? (
        <TextComposer
          label="Editar comentário"
          initialValue={comment.body}
          submitLabel="Salvar"
          onSubmit={saveEdit}
          onCancel={() => setMode("view")}
        />
      ) : (
        <UserText text={comment.body} className="text-[15.5px] leading-relaxed text-text-2" />
      )}

      {mode === "view" || mode === "reply" ? (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <ReactionBar
            kind="comment"
            id={comment.id}
            likeCount={comment.likeCount}
            dislikeCount={comment.dislikeCount}
            mine={state.mine[comment.id] ?? 0}
            loggedIn={viewer !== null}
            own={own}
            returnTo={returnTo}
            what={`comentário de ${who}`}
          />
          {viewer && !blocked ? (
            <button
              type="button"
              onClick={() => setMode(mode === "reply" ? "view" : "reply")}
              aria-expanded={mode === "reply"}
              aria-label={`Responder a ${who}`}
              className={`${ACTION} inline-flex h-8 items-center gap-1.5`}
            >
              <ReplyIcon width={13} height={13} /> Responder
            </button>
          ) : null}
          {canMarkHelpful ? (
            <button type="button" onClick={markHelpful} disabled={busy} className={`${ACTION_BASE} inline-flex h-8 items-center gap-1.5 text-acc hover:underline`}>
              <CheckIcon width={13} height={13} /> Útil
            </button>
          ) : null}
          {own ? (
            <>
              <button type="button" onClick={() => setMode("edit")} className={`${ACTION} h-8`}>
                Editar
              </button>
              <button type="button" onClick={() => setMode("confirm-delete")} className={`${ACTION} h-8`}>
                Apagar
              </button>
            </>
          ) : (
            <div className="pt-2">
              <ReportButton
                targetType="comment"
                targetId={comment.id}
                loggedIn={viewer !== null}
                returnTo={returnTo}
                what={`comentário de ${who}`}
              />
            </div>
          )}
        </div>
      ) : null}

      {mode === "reply" ? (
        <TextComposer
          label={`Responder a ${who}`}
          placeholder={`Responda a ${who}`}
          submitLabel="Responder"
          initialValue={comment.depth >= 2 && comment.author ? `@${comment.author.handle} ` : ""}
          rows={2}
          onSubmit={sendReply}
          onCancel={() => setMode("view")}
        />
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
      {notice ? (
        <p role="status" className="text-[13px] text-acc">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-nin">
          {error}
        </p>
      ) : null}
    </>
  );

  const hide = blocked ? "blocked" : isCollapsed(comment.likeCount, comment.dislikeCount) ? "disliked" : null;

  return (
    <li
      id={`comentario-${comment.id}`}
      className="flex scroll-mt-24 flex-col gap-2.5 border-b border-divider py-4 first:pt-0 last:border-b-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="inline-flex flex-wrap items-center gap-2.5">
          <AuthorBadge author={comment.author} size={comment.depth > 0 ? 24 : 28} />
          {comment.helpful ? (
            <span className="inline-flex items-center gap-1 bg-acc px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em] text-bg uppercase">
              <CheckIcon width={11} height={11} /> Útil
            </span>
          ) : null}
        </span>
        <time dateTime={new Date(comment.createdAt).toISOString()} className="font-mono text-[11px] text-dim">
          {formatWhen(comment.createdAt, true)}
          {comment.editedAt ? " · editado" : ""}
        </time>
      </div>
      {hide ? <Collapsible reason={hide}>{body}</Collapsible> : body}
      {replies}
    </li>
  );
}

const ACTION_BASE =
  "cursor-pointer font-mono text-[11px] tracking-[0.06em] uppercase disabled:cursor-wait disabled:opacity-60";
const ACTION = `${ACTION_BASE} text-dim hover:text-text`;
const DANGER = `${ACTION_BASE} text-nin hover:underline`;
