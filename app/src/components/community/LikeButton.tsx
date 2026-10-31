"use client";

import { useState, useTransition } from "react";
import { loginHref } from "@/components/guide/format";
import { likePhoto } from "@/lib/community/actions";
import { HeartIcon } from "./icons";

type LikeButtonProps = {
  photoId: string;
  liked: boolean;
  likeCount: number;
  loggedIn: boolean;
  returnTo: string;
  /** Anonymous fallback shown before the session is known. */
  pending?: boolean;
};

/** Curtir / descurtir with an optimistic count; logged-out visitors get a login link. */
export function LikeButton({ photoId, liked: initialLiked, likeCount, loggedIn, returnTo, pending = false }: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(likeCount);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle() {
    if (!loggedIn) {
      setMessage("login");
      return;
    }
    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    startTransition(async () => {
      const result = await likePhoto({ photoId });
      if (result.status === "ok") {
        setLiked(result.liked);
        setCount(result.likeCount);
        setMessage(null);
        return;
      }
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
      setMessage(result.status === "unauthenticated" ? "login" : result.message);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={liked}
        className={`inline-flex h-11 cursor-pointer items-center gap-2.5 self-start rounded-[2px] border px-4 font-mono text-[12px] font-bold tracking-[0.08em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
          liked ? "border-acc bg-acc text-bg" : "border-line-2 text-text hover:border-text"
        }`}
      >
        <HeartIcon filled={liked} width={18} height={18} />
        <span>Curtir</span>
        <span className="tabular-nums">
          {count}
          <span className="sr-only"> {count === 1 ? "curtida" : "curtidas"}</span>
        </span>
      </button>
      {message === "login" ? (
        <p role="status" className="font-mono text-[11px]">
          <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
            Entre na sua conta para curtir
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
