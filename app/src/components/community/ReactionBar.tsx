import { Suspense } from "react";
import { reactionCounts, myReactions } from "@/lib/community/reactions";
import { currentViewer } from "@/lib/community/viewer";
import { prisma } from "@/lib/db";
import { ReactionButtons } from "./ReactionButtons";

type ReactionBarProps = {
  targetType: "article" | "guide";
  targetId: string;
  /** "O que achou desta notícia?" */
  prompt: string;
  /** For screen readers: "esta notícia", "este guia". */
  what: string;
  returnTo: string;
};

/**
 * Like / dislike row for an article or a guide. The page around it can stay cached: the counts
 * and the visitor's own reaction stream in live, inside their own Suspense boundary.
 */
export function ReactionBar({ targetType, targetId, prompt, what, returnTo }: ReactionBarProps) {
  const shell = (
    <ReactionButtons
      targetType={targetType}
      targetId={targetId}
      likes={0}
      dislikes={0}
      mine={0}
      loggedIn={false}
      returnTo={returnTo}
      what={what}
      pending
    />
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-line bg-surface px-5 py-4">
      <p className="text-[15px] font-bold text-text-2">{prompt}</p>
      <Suspense fallback={shell}>
        <LiveReactions targetType={targetType} targetId={targetId} what={what} returnTo={returnTo} />
      </Suspense>
    </div>
  );
}

async function LiveReactions({ targetType, targetId, what, returnTo }: Omit<ReactionBarProps, "prompt">) {
  const viewer = await currentViewer();
  const [counts, mine] = await Promise.all([
    reactionCounts(prisma, targetType, targetId),
    viewer ? myReactions(prisma, viewer.id, targetType, [targetId]) : Promise.resolve({} as Record<string, 1 | -1>),
  ]);
  return (
    <ReactionButtons
      targetType={targetType}
      targetId={targetId}
      likes={counts.likes}
      dislikes={counts.dislikes}
      mine={mine[targetId] ?? 0}
      loggedIn={viewer !== null}
      returnTo={returnTo}
      what={what}
    />
  );
}
