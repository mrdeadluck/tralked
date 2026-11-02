"use client";

import { useState, useTransition } from "react";
import { loginHref } from "@/components/guide/format";
import { reactTo } from "@/lib/community/engagement-actions";
import {
  applyReaction,
  nextReaction,
  type MyReaction,
  type ReactionCounts,
  type ReactionTargetType,
  type ReactionValue,
} from "@/lib/community/reaction-rules";
import { ThumbDownIcon, ThumbUpIcon } from "./reaction-icons";

export type ReactionButtonsProps = {
  targetType: ReactionTargetType;
  targetId: string;
  likes: number;
  dislikes: number;
  /** The viewer's reaction: 1 like, -1 dislike, 0 none. */
  mine: MyReaction;
  loggedIn: boolean;
  returnTo: string;
  /** `sm`: quiet inline buttons (comments); `md`: bordered buttons (articles, guides, photos). */
  size?: "sm" | "md";
  /** What the buttons are about, for screen readers ("esta notícia", "o comentário de @x"). */
  what: string;
  /** Anonymous fallback shown before the session is known. */
  pending?: boolean;
};

/** "1.234": counts only when there is something to count (an empty counter shows no "0"). */
const count = (n: number) => (n > 0 ? n.toLocaleString("pt-BR") : null);

/**
 * Like / dislike pair with optimistic counts. The same button again removes the reaction; the
 * other one switches it. Logged-out visitors get a login link instead.
 */
export function ReactionButtons({
  targetType,
  targetId,
  likes,
  dislikes,
  mine: initialMine,
  loggedIn,
  returnTo,
  size = "md",
  what,
  pending = false,
}: ReactionButtonsProps) {
  const [mine, setMine] = useState<MyReaction>(initialMine);
  const [counts, setCounts] = useState<ReactionCounts>({ likes, dislikes });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function click(value: ReactionValue) {
    // Ignored (not disabled, so keyboard focus stays put) while the previous click is saving.
    if (busy) return;
    if (!loggedIn) {
      setMessage("login");
      return;
    }
    const before = mine;
    const beforeCounts = counts;
    const after = nextReaction(before, value);
    setMine(after);
    setCounts(applyReaction(beforeCounts, before, after));
    startTransition(async () => {
      const result = await reactTo({ targetType, targetId, value });
      if (result.status === "ok") {
        setMine(result.mine);
        setCounts(result.counts);
        setMessage(null);
        return;
      }
      setMine(before);
      setCounts(beforeCounts);
      setMessage(result.status === "unauthenticated" ? "login" : result.message);
    });
  }

  const sm = size === "sm";
  const base = sm
    ? "inline-flex min-h-6 cursor-pointer items-center gap-1.5 font-mono text-xs tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-45"
    : "inline-flex h-11 cursor-pointer items-center gap-2.5 rounded-[2px] border px-4 font-mono text-[12px] font-bold tracking-[0.08em] uppercase tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const likeClass = sm
    ? mine === 1
      ? "text-acc"
      : "text-dim hover:text-text"
    : mine === 1
      ? "border-acc bg-acc text-bg"
      : "border-line-2 text-text hover:border-text";
  const dislikeClass = sm
    ? mine === -1
      ? "text-text"
      : "text-dim hover:text-text"
    : mine === -1
      ? "border-text bg-hover-2 text-text"
      : "border-line-2 text-text hover:border-text";
  const icon = sm ? 15 : 18;
  const likeCount = count(counts.likes);
  const dislikeCount = count(counts.dislikes);

  return (
    <div className={`flex flex-col ${sm ? "gap-1" : "gap-2"}`}>
      <div role="group" aria-label={`Reações a ${what}`} aria-busy={busy || undefined} className={`flex items-center ${sm ? "gap-3.5" : "gap-2"}`}>
        <button
          type="button"
          onClick={() => click(1)}
          disabled={pending}
          aria-pressed={mine === 1}
          aria-label={`Curtir${likeCount ? ` (${counts.likes === 1 ? "1 curtida" : `${likeCount} curtidas`})` : ""}`}
          className={`${base} ${likeClass}`}
        >
          <ThumbUpIcon filled={mine === 1} width={icon} height={icon} />
          {sm ? null : <span>Curtir</span>}
          {likeCount ? <span aria-hidden="true">{likeCount}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => click(-1)}
          disabled={pending}
          aria-pressed={mine === -1}
          aria-label={`Não curtir${dislikeCount ? ` (${counts.dislikes === 1 ? "1 descurtida" : `${dislikeCount} descurtidas`})` : ""}`}
          className={`${base} ${dislikeClass}`}
        >
          <ThumbDownIcon filled={mine === -1} width={icon} height={icon} />
          {dislikeCount ? <span aria-hidden="true">{dislikeCount}</span> : null}
        </button>
      </div>
      {message === "login" ? (
        <p role="status" className="font-mono text-xs">
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
