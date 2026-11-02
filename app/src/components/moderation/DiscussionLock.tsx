"use client";

import { useState, useTransition } from "react";
import type { CommentTargetType } from "@/lib/community/comments";
import { lockDiscussionAction } from "@/lib/moderation/actions";

/** Shown instead of the comment box when the moderation locked the discussion. */
export function LockedNotice() {
  return (
    <p role="status" className="rounded-[4px] border border-line bg-surface px-4 py-3.5 text-[15px] text-muted">
      <b className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase">Discussão trancada.</b> A moderação
      fechou os comentários aqui.
    </p>
  );
}

type LockToggleProps = {
  targetType: CommentTargetType;
  targetId: string;
  locked: boolean;
  onChange: (locked: boolean) => void;
};

/** "Trancar discussão" / "Destrancar discussão" (rendered only for moderators). */
export function DiscussionLockToggle({ targetType, targetId, locked, onChange }: LockToggleProps) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (!locked && !window.confirm("Trancar a discussão? Ninguém poderá comentar até destrancar.")) return;
    start(async () => {
      const result = await lockDiscussionAction({ targetType, targetId, locked: !locked });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        onChange(!locked);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="cursor-pointer font-mono text-xs tracking-[0.06em] text-dim uppercase hover:text-text disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Aguarde…" : locked ? "Destrancar discussão" : "Trancar discussão"}
      </button>
      {error ? (
        <span role="alert" className="text-[13px] text-nin">
          {error}
        </span>
      ) : null}
    </span>
  );
}
