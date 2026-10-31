import { Suspense } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import { findCommentTarget, listComments, type CommentTargetType } from "@/lib/community/comments";
import { currentViewer } from "@/lib/community/viewer";
import { prisma } from "@/lib/db";
import { CommentsClient } from "./CommentsClient";

type CommentsProps = {
  /** article | guide | photo | thread */
  targetType: CommentTargetType;
  /** Id of the Article, Guide, Photo or ForumThread. */
  targetId: string;
  title?: string;
  /** Compact layout for narrow side columns (photo page). */
  compact?: boolean;
};

/**
 * Comment section for news, guides, photos and threads. Drop it anywhere in a page: it renders
 * its own heading and streams the comments and the visitor's session inside a Suspense boundary,
 * so the page around it can stay static and cached.
 */
export function Comments({ targetType, targetId, title = "Comentários", compact = false }: CommentsProps) {
  return (
    <section id="comentarios" aria-label={title} className="flex scroll-mt-24 flex-col gap-5">
      {compact ? (
        <h2 className="font-mono text-[11px] tracking-[0.12em] text-dim uppercase">{title}</h2>
      ) : (
        <SectionHead title={title} />
      )}
      <Suspense fallback={<CommentsLoading />}>
        <CommentsIsland targetType={targetType} targetId={targetId} />
      </Suspense>
    </section>
  );
}

async function CommentsIsland({ targetType, targetId }: { targetType: CommentTargetType; targetId: string }) {
  const [viewer, target, page] = await Promise.all([
    currentViewer(),
    findCommentTarget(prisma, targetType, targetId),
    listComments(prisma, targetType, targetId),
  ]);
  if (!target) {
    return <p className="text-[15px] text-muted">Os comentários estão fechados aqui.</p>;
  }
  return (
    <CommentsClient
      targetType={targetType}
      targetId={targetId}
      initial={page}
      viewer={viewer}
      returnTo={`${target.href}#comentarios`}
    />
  );
}

function CommentsLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando comentários" className="flex flex-col gap-3">
      <div className="h-[104px] animate-pulse rounded-[4px] border border-line bg-surface" />
      <div className="h-16 animate-pulse rounded-[4px] bg-surface" />
    </div>
  );
}
