import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { PageHead } from "@/components/community/PageHead";
import { Pager, pageParam } from "@/components/community/Pager";
import { ClearConversationButton } from "@/components/social/ClearConversationButton";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listInbox, type InboxRow } from "@/lib/social/messages";
import { timeAgo } from "@/lib/time-ago";

export const metadata: Metadata = {
  title: "Mensagens · Tralked",
  description: "Suas conversas privadas no Tralked.",
  robots: { index: false, follow: false },
};

export default function MensagensPage({ searchParams }: PageProps<"/mensagens">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Mensagens"
        lede="Conversas privadas, só entre você e a outra pessoa. Para começar uma, abra o perfil de alguém e toque em Mensagem."
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando conversas…</p>}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/mensagens">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) return <AccountLogin returnTo="/mensagens" />;
  const { pagina } = await searchParams;
  const inbox = await listInbox(prisma, user.id, pageParam(pagina));
  const now = new Date();

  if (inbox.total === 0) {
    return (
      <p className="max-w-[60ch] text-[15.5px] text-muted">
        Nenhuma conversa ainda. Quem pode mandar mensagem para você é escolhido em{" "}
        <Link href="/conta#mensagens" className="text-acc underline underline-offset-2">
          Conta
        </Link>
        .
      </p>
    );
  }

  return (
    <section aria-label="Suas conversas" className="flex flex-col gap-4">
      <ul className="m-0 list-none border-t border-line p-0">
        {inbox.rows.map((row) => (
          <li key={row.conversationId} className="border-b border-line">
            <Row row={row} when={timeAgo(row.lastMessageAt, now)} />
          </li>
        ))}
      </ul>
      <Pager page={inbox.page} pageCount={inbox.pageCount} href={(page) => `/mensagens?pagina=${page}`} label="Páginas de conversas" />
    </section>
  );
}

function Row({ row, when }: { row: InboxRow; when: string }) {
  const name = row.other ? row.other.displayName : "Conta removida";
  const content = (
    <span className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <span aria-hidden="true" className={`mt-[9px] size-2 rounded-full ${row.unread ? "bg-acc" : "bg-track"}`} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className={`text-[16px] leading-snug ${row.unread ? "font-bold text-text" : "text-text-2"}`}>
          {name}
          {row.other ? <span className="font-mono text-[12px] font-normal text-dim"> @{row.other.handle}</span> : null}
          {row.unread ? <span className="sr-only"> (mensagens não lidas)</span> : null}
        </span>
        {row.preview ? (
          <span className="line-clamp-1 max-w-[68ch] text-[14.5px] text-muted">
            {row.lastFromMe ? "Você: " : ""}
            {row.preview}
          </span>
        ) : null}
      </span>
      <time dateTime={row.lastMessageAt.toISOString()} className="font-mono text-[11px] whitespace-nowrap text-dim">
        {when}
      </time>
    </span>
  );
  if (row.other) {
    return (
      <Link href={`/mensagens/${encodeURIComponent(row.other.handle)}`} className="block px-1 py-4 hover:bg-hover">
        {content}
      </Link>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-1 py-4">
      {content}
      <div className="pl-[22px]">
        <ClearConversationButton conversationId={row.conversationId} />
      </div>
    </div>
  );
}
