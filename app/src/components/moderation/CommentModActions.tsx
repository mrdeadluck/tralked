"use client";

import { useState, useTransition } from "react";
import { moderateCommentAction } from "@/lib/moderation/actions";
import { ConfirmWithReason } from "./ConfirmWithReason";

type CommentModActionsProps = {
  commentId: string;
  pinned: boolean;
  /** "comentário de @x", for screen readers. */
  what: string;
  onRemoved: () => void;
  /** Absent for replies: only top-level comments can be pinned (no "Fixar" button). */
  onPinned?: (pinned: boolean) => void;
};

const ACTION =
  "cursor-pointer font-mono text-xs tracking-[0.06em] text-dim uppercase hover:text-text disabled:cursor-wait disabled:opacity-60";

/** Moderator controls on one comment: pin/unpin and remove (rendered only for moderators). */
export function CommentModActions({ commentId, pinned, what, onRemoved, onPinned }: CommentModActionsProps) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function togglePin() {
    start(async () => {
      const result = await moderateCommentAction({ id: commentId, action: pinned ? "unpin" : "pin" });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        onPinned?.(!pinned);
      }
    });
  }

  return (
    <>
      {onPinned ? (
        <button type="button" onClick={togglePin} disabled={busy} aria-label={`${pinned ? "Desafixar" : "Fixar"} ${what}`} className={ACTION}>
          {pinned ? "Desafixar" : "Fixar"}
        </button>
      ) : null}
      <ConfirmWithReason
        label="Remover"
        ariaLabel={`Remover ${what}`}
        prompt="Remover este comentário? No lugar dele fica “Comentário removido pela moderação”."
        confirmLabel="Sim, remover"
        onConfirm={async (reason) => {
          const result = await moderateCommentAction({ id: commentId, action: "remove", reason });
          if (!result.ok) return result.error;
          onRemoved();
          return null;
        }}
      />
      {error ? (
        <p role="alert" className="basis-full text-[13px] text-nin">
          {error}
        </p>
      ) : null}
    </>
  );
}
