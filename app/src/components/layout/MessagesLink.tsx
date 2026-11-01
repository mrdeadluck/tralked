import Link from "next/link";

function EnvelopeIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="m3.5 6 8.5 7 8.5-7" />
    </svg>
  );
}

const countLabel = (n: number) => (n > 99 ? "99+" : String(n));

/** Header link to /mensagens with the number of conversations that have unread messages. */
export function MessagesLink({ unread }: { unread: number }) {
  const label =
    unread > 0 ? `Mensagens, ${unread} ${unread === 1 ? "conversa não lida" : "conversas não lidas"}` : "Mensagens";
  return (
    <Link
      href="/mensagens"
      aria-label={label}
      className="relative grid size-10 place-items-center rounded-[2px] border border-line-2 bg-surface-2 text-text-3 hover:border-acc hover:text-text"
    >
      <EnvelopeIcon />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-acc px-1 font-mono text-[10.5px] font-bold text-bg tabular-nums"
        >
          {countLabel(unread)}
        </span>
      ) : null}
    </Link>
  );
}
