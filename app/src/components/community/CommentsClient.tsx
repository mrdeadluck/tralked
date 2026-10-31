"use client";

import { useState, useTransition } from "react";
import { loginHref } from "@/components/guide/format";
import { loadMoreComments, postComment, removeComment, updateComment } from "@/lib/community/actions";
import type { CommentPage, CommentTargetType, CommentView } from "@/lib/community/comments";
import { formatWhen, plural } from "@/lib/community/format";
import type { Viewer } from "@/lib/community/viewer";
import { AuthorBadge } from "./AuthorBadge";
import { ReportButton } from "./ReportButton";
import { TextComposer } from "./TextComposer";
import { UserText } from "./UserText";

type CommentsClientProps = {
  targetType: CommentTargetType;
  targetId: string;
  initial: CommentPage;
  viewer: Viewer;
  returnTo: string;
};

export function CommentsClient({ targetType, targetId, initial, viewer, returnTo }: CommentsClientProps) {
  const [comments, setComments] = useState(initial.comments);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [total, setTotal] = useState(initial.total);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  async function submit(body: string) {
    const result = await postComment({ targetType, targetId, body });
    if (result.status !== "ok") return result.message;
    setComments((list) => [result.comment, ...list]);
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
      setCursor(result.nextCursor);
    });
  }

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
          para comentar.
        </p>
      )}

      <p className="font-mono text-[11px] tracking-[0.08em] text-dim uppercase" aria-live="polite">
        {total === 0 ? "Nenhum comentário ainda" : plural(total, "comentário", "comentários")}
      </p>

      {comments.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              viewer={viewer}
              returnTo={returnTo}
              onChanged={(updated) => setComments((list) => list.map((c) => (c.id === updated.id ? updated : c)))}
              onDeleted={() => {
                setComments((list) =>
                  list.map((c) =>
                    c.id === comment.id ? { ...c, deleted: true, body: "", author: null, editedAt: null } : c,
                  ),
                );
                setTotal((n) => Math.max(0, n - 1));
              }}
            />
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
  viewer: Viewer;
  returnTo: string;
  onChanged: (comment: CommentView) => void;
  onDeleted: () => void;
};

function CommentItem({ comment, viewer, returnTo, onChanged, onDeleted }: CommentItemProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const own = viewer !== null && comment.author?.id === viewer.id;

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

  if (comment.deleted) {
    return (
      <li id={`comentario-${comment.id}`} className="border-b border-divider py-4 first:pt-0">
        <p className="font-mono text-[12px] text-dim italic">Comentário apagado</p>
      </li>
    );
  }

  return (
    <li id={`comentario-${comment.id}`} className="flex flex-col gap-2.5 border-b border-divider py-4 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <AuthorBadge author={comment.author} size={28} />
        <time dateTime={new Date(comment.createdAt).toISOString()} className="font-mono text-[11px] text-dim">
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
        <UserText text={comment.body} className="text-[15.5px] leading-relaxed text-text-2" />
      )}

      {mode === "view" ? (
        <div className="flex flex-wrap items-start gap-4">
          {own ? (
            <>
              <button type="button" onClick={() => setMode("edit")} className={ACTION}>
                Editar
              </button>
              <button type="button" onClick={() => setMode("confirm-delete")} className={ACTION}>
                Apagar
              </button>
            </>
          ) : (
            <ReportButton
              targetType="comment"
              targetId={comment.id}
              loggedIn={viewer !== null}
              returnTo={returnTo}
              what={`comentário de ${comment.author ? `@${comment.author.handle}` : "conta removida"}`}
            />
          )}
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
    </li>
  );
}

const ACTION_BASE =
  "cursor-pointer font-mono text-[11px] tracking-[0.06em] uppercase disabled:cursor-wait disabled:opacity-60";
const ACTION = `${ACTION_BASE} text-dim hover:text-text`;
const DANGER = `${ACTION_BASE} text-nin hover:underline`;
