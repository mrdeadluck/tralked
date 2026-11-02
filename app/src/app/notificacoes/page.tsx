import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountLogin } from "@/components/account/AccountLogin";
import { PageHead } from "@/components/community/PageHead";
import { Pager, pageParam } from "@/components/community/Pager";
import { MarkAllReadButton } from "@/components/layout/MarkAllReadButton";
import { getSessionUser } from "@/lib/auth/session";
import { getInbox, type NotificationView } from "@/lib/notifications/inbox";
import { NOTIFICATION_RETENTION_DAYS } from "@/lib/notifications/retention";
import { timeAgo } from "@/lib/time-ago";

export const metadata: Metadata = {
  title: "Notificações · Tralked",
  description: "Respostas, curtidas, subidas de nível e avisos da sua conta no Tralked.",
  robots: { index: false },
};

export default function NotificacoesPage({ searchParams }: PageProps<"/notificacoes">) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
      <PageHead
        title="Notificações"
        lede={`Respostas, curtidas, subidas de nível e avisos da sua conta. Cada notificação fica guardada por ${NOTIFICATION_RETENTION_DAYS} dias.`}
      />
      <Suspense fallback={<p className="font-mono text-xs text-dim">Carregando notificações…</p>}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/notificacoes">["searchParams"] }) {
  const user = await getSessionUser();
  if (!user) return <AccountLogin returnTo="/notificacoes" />;

  const { pagina } = await searchParams;
  const inbox = await getInbox(user.id, pageParam(pagina));
  const now = new Date();

  if (inbox.total === 0) {
    return (
      <p className="max-w-[60ch] text-[15.5px] text-muted">
        Nada por aqui ainda. Quando alguém responder um comentário seu, curtir uma foto ou quando você
        subir de nível, o aviso aparece aqui e no sino do topo.
      </p>
    );
  }

  return (
    <section aria-label="Suas notificações" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-dim tabular-nums">
          {inbox.unread === 0
            ? "Tudo lido."
            : `${inbox.unread} não ${inbox.unread === 1 ? "lida" : "lidas"} de ${inbox.total}`}
        </p>
        {inbox.unread > 0 ? <MarkAllReadButton /> : null}
      </div>
      <ul className="m-0 list-none border-t border-line p-0">
        {inbox.items.map((item) => (
          <li key={item.id} className="border-b border-line">
            <Row item={item} when={timeAgo(item.createdAt, now)} />
          </li>
        ))}
      </ul>
      <Pager
        page={inbox.page}
        pageCount={inbox.pageCount}
        href={(page) => `/notificacoes?pagina=${page}`}
        label="Páginas de notificações"
      />
    </section>
  );
}

function Row({ item, when }: { item: NotificationView; when: string }) {
  const content = (
    <span className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <span aria-hidden="true" className={`mt-[9px] size-2 rounded-full ${item.read ? "bg-track" : "bg-acc"}`} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className={`text-[16px] leading-snug ${item.read ? "text-text-3" : "font-bold text-text"}`}>
          {item.title}
          {item.read ? null : <span className="sr-only"> (não lida)</span>}
        </span>
        {item.body ? <span className="max-w-[68ch] text-[14.5px] text-muted">{item.body}</span> : null}
      </span>
      <time dateTime={item.createdAt.toISOString()} className="font-mono text-xs whitespace-nowrap text-dim">
        {when}
      </time>
    </span>
  );
  return item.href ? (
    <Link href={item.href} className="block px-1 py-4 hover:bg-hover">
      {content}
    </Link>
  ) : (
    <div className="px-1 py-4">{content}</div>
  );
}
