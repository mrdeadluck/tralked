import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { AuthorBadge } from "@/components/community/AuthorBadge";
import { PageHead, Trail } from "@/components/community/PageHead";
import { ClearConversationButton } from "@/components/social/ClearConversationButton";
import { ConversationClient } from "@/components/social/ConversationClient";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { CAN_MESSAGE_TEXT, canMessage, openConversation } from "@/lib/social/messages";
import { getRelationship } from "@/lib/social/relations";

export const metadata: Metadata = {
  title: "Conversa · Tralked",
  robots: { index: false, follow: false },
};

export default function ConversaPage({ params, searchParams }: PageProps<"/mensagens/[handle]">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando a conversa…</p>}>
        <Conversation params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Conversation({
  params,
  searchParams,
}: {
  params: PageProps<"/mensagens/[handle]">["params"];
  searchParams: PageProps<"/mensagens/[handle]">["searchParams"];
}) {
  const [{ handle }, query, viewer] = await Promise.all([params, searchParams, getSessionUser()]);
  if (!viewer) return <AccountLogin returnTo={`/mensagens/${encodeURIComponent(decodeURIComponent(handle))}`} />;
  const other = await prisma.user.findUnique({
    where: { handle: decodeURIComponent(handle) },
    select: { id: true, handle: true, displayName: true, avatarUrl: true },
  });
  if (!other) notFound();
  if (other.id === viewer.id) redirect("/mensagens");

  const before = typeof query.antes === "string" ? query.antes : null;
  const [conversation, allowed, relationship] = await Promise.all([
    openConversation(prisma, viewer.id, other.id, before),
    canMessage(prisma, viewer.id, other.id),
    getRelationship(prisma, viewer.id, other.id),
  ]);
  const base = `/mensagens/${encodeURIComponent(other.handle)}`;

  return (
    <>
      <PageHead
        title={other.displayName}
        trail={
          <Trail>
            <Link href="/mensagens" className="hover:text-acc">
              Mensagens
            </Link>
          </Trail>
        }
        aside={<AuthorBadge author={other} size={28} />}
      />
      {conversation.olderCursor ? (
        <Link href={`${base}?antes=${conversation.olderCursor}`} className="self-start font-mono text-[11px] tracking-[0.08em] text-acc uppercase">
          ↑ Mensagens anteriores
        </Link>
      ) : before ? (
        <Link href={base} className="self-start font-mono text-[11px] tracking-[0.08em] text-acc uppercase">
          Voltar às mensagens recentes
        </Link>
      ) : null}
      <ConversationClient
        key={`${other.id}:${before ?? "latest"}`}
        other={{ id: other.id, handle: other.handle }}
        messages={conversation.messages}
        // Older pages are read-only snapshots; only the latest one polls and takes new messages.
        live={!before}
        canSend={allowed.ok}
        cannotSendReason={allowed.ok ? null : CAN_MESSAGE_TEXT[allowed.reason]}
        blocked={relationship.blocked}
      />
      {conversation.conversationId ? (
        <div className="border-t border-line pt-4">
          <ClearConversationButton conversationId={conversation.conversationId} redirectTo="/mensagens" />
        </div>
      ) : null}
    </>
  );
}
