"use client";

import { useState, useTransition } from "react";
import { ThumbDownIcon, ThumbUpIcon } from "@/components/community/icons";
import { loginHref } from "@/components/guide/format";
import { reactAction } from "@/lib/social/actions";

type ReactionBarProps = {
  kind: "comment" | "post";
  id: string;
  likeCount: number;
  dislikeCount: number;
  /** The viewer's reaction: 1, -1 or 0. */
  mine: 1 | -1 | 0;
  loggedIn: boolean;
  /** The viewer wrote it: counts only, no buttons. */
  own: boolean;
  returnTo: string;
  /** Anonymous fallback shown before the session is known. */
  pending?: boolean;
  /** Whose text it is, for screen readers ("comentário de @fulano"). */
  what: string;
};

const BUTTON =
  "inline-flex h-8 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-[2px] border px-2 font-mono text-[11px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-45";

/**
 * Curtir / descurtir a comment or forum post, with optimistic counts. Clicking the active one
 * again removes it. Liking pays a little XP to the author (never to whoever likes).
 */
export function ReactionBar(props: ReactionBarProps) {
  const { kind, id, loggedIn, own, returnTo, pending = false, what } = props;
  const [state, setState] = useState({ mine: props.mine, likes: props.likeCount, dislikes: props.dislikeCount });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (own) {
    return (
      <span className="inline-flex items-center gap-3 font-mono text-[11px] text-dim tabular-nums">
        <span className="inline-flex items-center gap-1">
          <ThumbUpIcon width={13} height={13} />
          {state.likes}
          <span className="sr-only">{state.likes === 1 ? " curtida" : " curtidas"}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbDownIcon width={13} height={13} />
          {state.dislikes}
          <span className="sr-only">{state.dislikes === 1 ? " descurtida" : " descurtidas"}</span>
        </span>
      </span>
    );
  }

  function click(value: 1 | -1) {
    if (!loggedIn) {
      setMessage("login");
      return;
    }
    const before = state;
    const mine = state.mine === value ? 0 : value;
    const likes = state.likes + (mine === 1 ? 1 : 0) - (state.mine === 1 ? 1 : 0);
    const dislikes = state.dislikes + (mine === -1 ? 1 : 0) - (state.mine === -1 ? 1 : 0);
    setState({ mine, likes, dislikes });
    startTransition(async () => {
      const result = await reactAction({ kind, id, value });
      if (result.status === "ok") {
        setState({ mine: result.mine, likes: result.likeCount, dislikes: result.dislikeCount });
        setMessage(null);
      } else {
        setState(before);
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div role="group" aria-label={`Reações ao ${what}`} className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => click(1)}
          disabled={pending || busy}
          aria-pressed={state.mine === 1}
          aria-label={`Curtir (${state.likes})`}
          className={`${BUTTON} ${state.mine === 1 ? "border-acc bg-acc text-bg" : "border-line-2 text-text-3 hover:border-text hover:text-text"}`}
        >
          <ThumbUpIcon filled={state.mine === 1} width={14} height={14} />
          <span aria-hidden="true">{state.likes}</span>
        </button>
        <button
          type="button"
          onClick={() => click(-1)}
          disabled={pending || busy}
          aria-pressed={state.mine === -1}
          aria-label={`Descurtir (${state.dislikes})`}
          className={`${BUTTON} ${state.mine === -1 ? "border-text bg-text text-bg" : "border-line-2 text-text-3 hover:border-text hover:text-text"}`}
        >
          <ThumbDownIcon filled={state.mine === -1} width={14} height={14} />
          <span aria-hidden="true">{state.dislikes}</span>
        </button>
      </div>
      {message === "login" ? (
        <p role="status" className="font-mono text-[11px]">
          <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
            Entre na sua conta para reagir
          </a>
        </p>
      ) : message ? (
        <p role="alert" className="text-[13px] text-nin">
          {message}
        </p>
      ) : null}
    </div>
  );
}
