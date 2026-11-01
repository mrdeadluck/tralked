"use client";

import { useMemo, useState, useTransition } from "react";
import { loginHref } from "@/components/guide/format";
import { Collapsible } from "@/components/social/Collapsible";
import { ReactionBar } from "@/components/social/ReactionBar";
import { markThreadSolved, replyToThread } from "@/lib/community/actions";
import type { PostView, ThreadDetail } from "@/lib/community/forum";
import { formatWhen } from "@/lib/community/format";
import { FORUM_SOLVED_XP } from "@/lib/community/rewards";
import type { Viewer } from "@/lib/community/viewer";
import { COMMENT_HELPFUL_XP, isCollapsed } from "@/lib/engine/social";
import { markHelpfulAction } from "@/lib/social/actions";
import { buildTree, type TreeNode } from "@/lib/social/threads";
import { EMPTY_VIEWER_STATE, type SocialViewerState } from "@/lib/social/types";
import { AuthorBadge } from "./AuthorBadge";
import { CheckIcon, ReplyIcon } from "./icons";
import { ReportButton } from "./ReportButton";
import { TextComposer } from "./TextComposer";
import { UserText } from "./UserText";

type ThreadViewProps = {
  thread: ThreadDetail;
  viewer: Viewer;
  /** The visitor's reactions and blocks (read per request; the thread itself is cached). */
  viewerState?: SocialViewerState;
  /** Anonymous fallback shown before the session is known. */
  pending?: boolean;
};

type Shared = {
  thread: ThreadDetail;
  viewer: Viewer;
  state: SocialViewerState;
  pending: boolean;
  solvedId: string | null;
  openingId: string | null;
  marking: boolean;
  onMarkSolved: (post: PostView) => void;
  onReply: (parentId: string, body: string) => Promise<string | null>;
  onHelpful: (id: string) => void;
};

/**
 * Posts of a thread with threaded replies (2 levels), reactions, the "Útil" mark (author of the
 * replied post), the "Resolveu" mark (thread author only) and the reply box.
 */
export function ThreadView({ thread, viewer, viewerState = EMPTY_VIEWER_STATE, pending = false }: ThreadViewProps) {
  const [posts, setPosts] = useState(thread.posts);
  const [solvedId, setSolvedId] = useState(thread.solvedPostId);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [marking, startMarking] = useTransition();
  const returnTo = `/forum/t/${thread.id}`;
  const solvedPost = posts.find((p) => p.id === solvedId) ?? null;
  const tree = useMemo(() => buildTree(posts), [posts]);

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

  async function replyTo(parentId: string, body: string) {
    const result = await replyToThread({ threadId: thread.id, body, parentId });
    if (result.status !== "ok") return result.message;
    setPosts((list) => [...list, result.post]);
    return null;
  }

  const shared: Shared = {
    thread,
    viewer,
    state: viewerState,
    pending,
    solvedId,
    openingId: posts[0]?.id ?? null,
    marking,
    onMarkSolved: markSolved,
    onReply: replyTo,
    onHelpful: (id) => setPosts((list) => list.map((p) => (p.id === id ? { ...p, helpful: true } : p))),
  };

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
        {tree.map((node) => (
          <PostItem key={node.id} node={node} parentAuthorId={null} {...shared} />
        ))}
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

function PostItem(props: Shared & { node: TreeNode<PostView>; parentAuthorId: string | null }) {
  const { node: post, parentAuthorId, thread, viewer, state, pending, solvedId, openingId, marking } = props;
  const [replying, setReplying] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const returnTo = `/forum/t/${thread.id}`;
  const solved = post.id === solvedId;
  const own = viewer !== null && post.author?.id === viewer.id;
  const opening = post.id === openingId;
  const who = post.author ? `@${post.author.handle}` : "conta removida";
  const isThreadAuthor = viewer !== null && viewer.id === thread.authorId;
  const canMark = isThreadAuthor && solvedId === null && !opening && !own && !pending;
  const canHelpful = viewer !== null && parentAuthorId === viewer.id && !own && !post.helpful && post.author !== null && !pending;
  const blocked = post.author !== null && state.blocked.includes(post.author.id);
  const hide = blocked ? "blocked" : isCollapsed(post.likeCount, post.dislikeCount) ? "disliked" : null;

  function markHelpful() {
    startTransition(async () => {
      const result = await markHelpfulAction({ kind: "post", id: post.id });
      if (result.status === "ok") {
        props.onHelpful(post.id);
        setMessage({ tone: "ok", text: `Marcada como útil. ${who} pode ganhar ${COMMENT_HELPFUL_XP} XP.` });
      } else setMessage({ tone: "error", text: result.message });
    });
  }

  async function sendReply(body: string) {
    const result = await props.onReply(post.id, body);
    if (result === null) setReplying(false);
    return result;
  }

  const content = (
    <>
      <UserText text={post.body} className="max-w-[72ch] text-[16px] leading-relaxed text-text-2" />
      <footer className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <ReactionBar
          kind="post"
          id={post.id}
          likeCount={post.likeCount}
          dislikeCount={post.dislikeCount}
          mine={state.mine[post.id] ?? 0}
          loggedIn={viewer !== null}
          own={own}
          returnTo={`${returnTo}#post-${post.id}`}
          pending={pending}
          what={`mensagem de ${who}`}
        />
        {viewer && !thread.locked && !blocked && !pending ? (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            aria-expanded={replying}
            aria-label={`Responder a ${who}`}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-dim uppercase hover:text-text"
          >
            <ReplyIcon width={13} height={13} /> Responder
          </button>
        ) : null}
        {canHelpful ? (
          <button
            type="button"
            onClick={markHelpful}
            disabled={busy}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-acc uppercase hover:underline disabled:cursor-wait disabled:opacity-60"
          >
            <CheckIcon width={13} height={13} /> Útil
          </button>
        ) : null}
        {canMark ? (
          <button
            type="button"
            onClick={() => props.onMarkSolved(post)}
            disabled={marking}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[2px] border border-acc px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-acc uppercase hover:bg-acc hover:text-bg disabled:cursor-wait disabled:opacity-60"
          >
            <CheckIcon width={13} height={13} /> Esta resolveu
          </button>
        ) : null}
        {!own ? (
          <div className="pt-2">
            <ReportButton
              targetType="post"
              targetId={post.id}
              loggedIn={viewer !== null}
              returnTo={`${returnTo}#post-${post.id}`}
              what={`mensagem de ${who}`}
              pending={pending}
            />
          </div>
        ) : null}
      </footer>
      {replying ? (
        <TextComposer
          label={`Responder a ${who}`}
          placeholder={`Responda a ${who}`}
          submitLabel="Responder"
          initialValue={post.depth >= 2 && post.author ? `@${post.author.handle} ` : ""}
          rows={3}
          onSubmit={sendReply}
          onCancel={() => setReplying(false)}
        />
      ) : null}
      {message ? (
        <p role={message.tone === "ok" ? "status" : "alert"} className={`text-[13px] ${message.tone === "ok" ? "text-acc" : "text-nin"}`}>
          {message.text}
        </p>
      ) : null}
    </>
  );

  return (
    <li id={`post-${post.id}`} className="scroll-mt-24">
      <article
        aria-label={`${opening ? "Mensagem de abertura" : "Resposta"} de ${who}${solved ? ", marcada como a que resolveu" : ""}`}
        className={`flex flex-col gap-4 rounded-[4px] border ${post.depth > 0 ? "p-4" : "p-5"} ${
          solved ? "border-acc bg-acc/[0.04]" : "border-line bg-surface"
        }`}
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <AuthorBadge author={post.author} size={post.depth > 0 ? 26 : 32} />
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
            {post.helpful ? (
              <span className="inline-flex items-center gap-1 border border-acc px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em] text-acc uppercase">
                <CheckIcon width={11} height={11} /> Útil
              </span>
            ) : null}
          </div>
          <time dateTime={new Date(post.createdAt).toISOString()} className="font-mono text-[11px] text-dim">
            {formatWhen(post.createdAt, true)}
          </time>
        </header>
        {hide ? <Collapsible reason={hide}>{content}</Collapsible> : content}
      </article>
      {post.replies.length > 0 ? (
        <ol
          aria-label={`Respostas à mensagem de ${who}`}
          className="m-0 mt-3 flex list-none flex-col gap-3 border-l-2 border-line p-0 pl-4 min-[641px]:pl-6"
        >
          {post.replies.map((child) => (
            <PostItem key={child.id} {...props} node={child} parentAuthorId={post.author?.id ?? null} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}
