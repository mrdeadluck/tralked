"use client";

import { useState, useTransition } from "react";
import { loginHref } from "@/components/guide/format";
import { markThreadSolved, replyToThread } from "@/lib/community/actions";
import type { PostView, ThreadDetail } from "@/lib/community/forum";
import { formatWhen } from "@/lib/community/format";
import { FORUM_SOLVED_XP } from "@/lib/community/rewards";
import type { Viewer } from "@/lib/community/viewer";
import { AuthorBadge } from "./AuthorBadge";
import { CheckIcon } from "./icons";
import { ReportButton } from "./ReportButton";
import { TextComposer } from "./TextComposer";
import { UserText } from "./UserText";

type ThreadViewProps = {
  thread: ThreadDetail;
  viewer: Viewer;
  /** Anonymous fallback shown before the session is known. */
  pending?: boolean;
};

/** Posts of a thread, the "Resolveu" mark (thread author only) and the reply box. */
export function ThreadView({ thread, viewer, pending = false }: ThreadViewProps) {
  const [posts, setPosts] = useState(thread.posts);
  const [solvedId, setSolvedId] = useState(thread.solvedPostId);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [marking, startMarking] = useTransition();
  const returnTo = `/forum/t/${thread.id}`;
  const isThreadAuthor = viewer !== null && viewer.id === thread.authorId;
  const solvedPost = posts.find((p) => p.id === solvedId) ?? null;

  function markSolved(post: PostView) {
    startMarking(async () => {
      const result = await markThreadSolved({ threadId: thread.id, postId: post.id });
      if (result.status === "ok") {
        setSolvedId(post.id);
        setNotice({
          tone: "ok",
          text: post.author
            ? `Marcado! @${post.author.handle} ganhou ${FORUM_SOLVED_XP} XP em Sábio.`
            : "Marcado como a resposta que resolveu.",
        });
      } else {
        setNotice({ tone: "error", text: result.message });
      }
    });
  }

  async function reply(body: string) {
    const result = await replyToThread({ threadId: thread.id, body });
    if (result.status !== "ok") return result.message;
    setPosts((list) => [...list, result.post]);
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      {solvedPost ? (
        <p className="flex flex-wrap items-center gap-2 rounded-[4px] border border-acc/40 bg-acc/[0.06] px-4 py-3 text-[15px]">
          <CheckIcon className="text-acc" />
          <span>
            Resolvido pela resposta de{" "}
            <b>{solvedPost.author ? `@${solvedPost.author.handle}` : "conta removida"}</b>.{" "}
            <a href={`#post-${solvedPost.id}`} className="text-acc underline underline-offset-2">
              Ir para a resposta
            </a>
          </span>
        </p>
      ) : null}

      <ol className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Mensagens do tópico">
        {posts.map((post, index) => {
          const solved = post.id === solvedId;
          const own = viewer !== null && post.author?.id === viewer.id;
          const canMark = isThreadAuthor && solvedId === null && index > 0 && !own && !pending;
          return (
            <li key={post.id} id={`post-${post.id}`} className="scroll-mt-24">
              <article
                aria-label={`${index === 0 ? "Mensagem de abertura" : "Resposta"} de ${post.author ? `@${post.author.handle}` : "conta removida"}${solved ? ", marcada como a que resolveu" : ""}`}
                className={`flex flex-col gap-4 rounded-[4px] border p-5 ${
                  solved ? "border-acc bg-acc/[0.04]" : "border-line bg-surface"
                }`}
              >
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <AuthorBadge author={post.author} size={32} />
                    {post.author && post.author.id === thread.authorId ? (
                      <span className="border border-line-2 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-text-3 uppercase">
                        Autor do tópico
                      </span>
                    ) : null}
                    {solved ? (
                      <span className="inline-flex items-center gap-1 bg-acc px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em] text-bg uppercase">
                        <CheckIcon width={12} height={12} /> Resolveu
                      </span>
                    ) : null}
                  </div>
                  <time dateTime={new Date(post.createdAt).toISOString()} className="font-mono text-[11px] text-dim">
                    {formatWhen(post.createdAt, true)}
                  </time>
                </header>
                <UserText text={post.body} className="max-w-[72ch] text-[16px] leading-relaxed text-text-2" />
                <footer className="flex flex-wrap items-start gap-4">
                  {canMark ? (
                    <button
                      type="button"
                      onClick={() => markSolved(post)}
                      disabled={marking}
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[2px] border border-acc px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-acc uppercase hover:bg-acc hover:text-bg disabled:cursor-wait disabled:opacity-60"
                    >
                      <CheckIcon width={13} height={13} /> Esta resolveu
                    </button>
                  ) : null}
                  {!own ? (
                    <ReportButton
                      targetType="post"
                      targetId={post.id}
                      loggedIn={viewer !== null}
                      returnTo={`${returnTo}#post-${post.id}`}
                      what={`mensagem de ${post.author ? `@${post.author.handle}` : "conta removida"}`}
                      pending={pending}
                    />
                  ) : null}
                </footer>
              </article>
            </li>
          );
        })}
      </ol>

      {notice ? (
        <p role={notice.tone === "ok" ? "status" : "alert"} className={`text-[14px] ${notice.tone === "ok" ? "text-acc" : "text-nin"}`}>
          {notice.text}
        </p>
      ) : null}

      <section aria-labelledby="responder" className="flex flex-col gap-3">
        <h2 id="responder" className="text-[20px] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Responder
        </h2>
        {thread.locked ? (
          <p className="text-[15px] text-muted">Este tópico está trancado e não recebe novas respostas.</p>
        ) : viewer ? (
          <TextComposer label="Sua resposta" placeholder="Ajude com o que você sabe." submitLabel="Responder" rows={4} onSubmit={reply} />
        ) : (
          <p className="rounded-[4px] border border-line bg-surface px-4 py-3.5 text-[15px] text-muted">
            <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
              Entre na sua conta
            </a>{" "}
            para responder. Respostas marcadas como “resolveu” rendem {FORUM_SOLVED_XP} XP em Sábio.
          </p>
        )}
      </section>
    </div>
  );
}
