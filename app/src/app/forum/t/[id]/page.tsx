import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckIcon, LockIcon } from "@/components/community/icons";
import { PageHead, Trail } from "@/components/community/PageHead";
import { ThreadView } from "@/components/community/ThreadView";
import { getThreadCached } from "@/lib/community/cached";
import { recentThreadIds, type ThreadDetail } from "@/lib/community/forum";
import { formatWhen, plural } from "@/lib/community/format";
import { preview } from "@/lib/community/notify";
import { currentViewer } from "@/lib/community/viewer";

export async function generateStaticParams() {
  const ids = await recentThreadIds(20);
  return (ids.length > 0 ? ids : ["exemplo"]).map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/forum/t/[id]">): Promise<Metadata> {
  const { id } = await params;
  const thread = await getThreadCached(id);
  if (!thread) return { title: "Tópico não encontrado | Tralked" };
  return {
    title: `${thread.title} | Fórum Tralked`,
    description: thread.posts[0] ? preview(thread.posts[0].body) : undefined,
    alternates: { canonical: `/forum/t/${id}` },
  };
}

export default async function ThreadPage({ params }: PageProps<"/forum/t/[id]">) {
  const { id } = await params;
  const thread = await getThreadCached(id);
  if (!thread) notFound();
  const section = thread.category ?? thread.game;
  const replies = Math.max(0, thread.posts.length - 1);

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8">
      <PageHead
        title={thread.title}
        trail={
          <Trail>
            <Link href="/forum" className="hover:text-acc">
              Fórum
            </Link>
            {section ? (
              <>
                {" / "}
                <Link href={`/forum/${section.slug}`} className="hover:text-acc">
                  {section.name}
                </Link>
              </>
            ) : null}
          </Trail>
        }
        aside={<ThreadFacts thread={thread} replies={replies} />}
      />

      <Suspense fallback={<ThreadView thread={thread} viewer={null} pending />}>
        <ThreadIsland thread={thread} />
      </Suspense>
    </div>
  );
}

function ThreadFacts({ thread, replies }: { thread: ThreadDetail; replies: number }) {
  return (
    <span className="flex flex-wrap items-center gap-3">
      {thread.solvedPostId ? (
        <span className="inline-flex items-center gap-1 text-acc">
          <CheckIcon width={13} height={13} /> Resolvido
        </span>
      ) : null}
      {thread.locked ? (
        <span className="inline-flex items-center gap-1">
          <LockIcon width={13} height={13} /> Trancado
        </span>
      ) : null}
      <span>{plural(replies, "resposta", "respostas")}</span>
      <span>aberto em {formatWhen(thread.createdAt)}</span>
      {thread.game && thread.category ? (
        <Link href={`/jogos/${thread.game.slug}`} className="hover:text-acc">
          {thread.game.name}
        </Link>
      ) : null}
    </span>
  );
}

async function ThreadIsland({ thread }: { thread: ThreadDetail }) {
  const viewer = await currentViewer();
  return <ThreadView thread={thread} viewer={viewer} />;
}
