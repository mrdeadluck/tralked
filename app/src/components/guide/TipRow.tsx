"use client";

import { useState, useTransition } from "react";
import { voteTip } from "@/app/jogos/[slug]/guia/actions";
import type { GuideTipView } from "@/lib/queries/games";
import { LoginNudge } from "./LoginNudge";

type TipRowProps = {
  tip: GuideTipView;
  loggedIn: boolean;
  returnTo: string;
  pending?: boolean;
};

export function TipRow({ tip, loggedIn, returnTo, pending = false }: TipRowProps) {
  const [votes, setVotes] = useState(tip.votes);
  const [voted, setVoted] = useState(tip.voted);
  const [nudge, setNudge] = useState(false);
  const [, startTransition] = useTransition();

  function onVote() {
    if (!loggedIn) {
      setNudge(true);
      return;
    }
    if (voted || tip.isOwn) return;
    setVoted(true);
    setVotes((v) => v + 1);
    startTransition(async () => {
      const result = await voteTip(tip.id);
      if (result.status === "voted") {
        setVotes(result.votes);
        return;
      }
      if (result.status === "already_voted") return;
      // Rejected: undo the optimistic update.
      setVoted(false);
      setVotes((v) => v - 1);
      if (result.status === "unauthenticated") setNudge(true);
    });
  }

  const label = tip.isOwn
    ? "Você não pode votar na própria dica"
    : voted
      ? "Você marcou esta dica como útil"
      : "Marcar dica como útil";

  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3.5 border-b border-line py-5">
      <span
        aria-hidden="true"
        className="size-10 rounded-full bg-[repeating-linear-gradient(135deg,#1C1E24_0_4px,#24262D_4px_8px)]"
      />
      <div>
        <div className="flex flex-wrap gap-3.5 font-mono text-[11.5px] text-dim">
          <span className="text-text-2">{tip.authorHandle ? `@${tip.authorHandle}` : "Anônimo"}</span>
          {tip.authorLevel !== null ? <span>NV {tip.authorLevel}</span> : null}
        </div>
        <p className="mt-1.5 text-[15.5px] text-text-2">{tip.body}</p>
        {nudge ? <LoginNudge returnTo={returnTo} className="mt-2" /> : null}
      </div>
      <button
        type="button"
        onClick={onVote}
        aria-pressed={voted}
        aria-label={label}
        disabled={tip.isOwn || pending}
        className={`flex h-fit min-w-14 cursor-pointer flex-col items-center gap-0.5 rounded-[2px] border bg-transparent px-2 py-1.5 font-mono text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
          voted ? "border-acc text-acc" : "border-line-2 text-text-3 hover:border-dim"
        }`}
      >
        <span aria-hidden="true">▲</span>
        <span>{votes}</span>
      </button>
    </li>
  );
}
