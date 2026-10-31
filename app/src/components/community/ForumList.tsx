import Link from "next/link";
import type { ReactNode } from "react";
import type { ThreadRow } from "@/lib/community/forum";
import { formatWhen, plural } from "@/lib/community/format";
import { CheckIcon, LockIcon, PinIcon } from "./icons";

type ForumListProps = {
  threads: ThreadRow[];
  /** Show the thread's section (category or game) under the title. */
  showSection?: boolean;
  empty: string;
  label: string;
};

/** Thread list: title with state marks (fixado, resolvido, trancado), author, replies, last activity. */
export function ForumList({ threads, showSection = false, empty, label }: ForumListProps) {
  if (threads.length === 0) {
    return <p className="border border-dashed border-line-2 px-6 py-12 text-center text-[15px] text-muted">{empty}</p>;
  }
  return (
    <ul aria-label={label} className="m-0 list-none border-t border-line p-0">
      {threads.map((thread) => (
        <li
          key={thread.id}
          className="grid grid-cols-[minmax(0,1fr)_96px_132px] items-center gap-4 border-b border-line py-4 max-[700px]:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {thread.pinned ? <Mark icon={<PinIcon width={12} height={12} />} label="Fixado" tone="text-text-2" /> : null}
              {thread.solved ? <Mark icon={<CheckIcon width={12} height={12} />} label="Resolvido" tone="text-acc" /> : null}
              {thread.locked ? <Mark icon={<LockIcon width={12} height={12} />} label="Trancado" tone="text-dim" /> : null}
              <Link
                href={`/forum/t/${thread.id}`}
                className="text-[17px] leading-snug font-bold text-text hover:text-acc"
              >
                {thread.title}
              </Link>
            </div>
            <p className="font-mono text-[11px] text-dim">
              {thread.author ? `@${thread.author.handle}` : "Conta removida"}
              {showSection && (thread.category || thread.game) ? (
                <>
                  {" em "}
                  <Link
                    href={`/forum/${thread.category?.slug ?? thread.game!.slug}`}
                    className="text-text-3 underline decoration-line-2 underline-offset-2 hover:text-acc"
                  >
                    {thread.category?.name ?? thread.game!.name}
                  </Link>
                </>
              ) : null}
              {thread.category && thread.game ? ` · ${thread.game.name}` : null}
            </p>
          </div>
          <span className="text-right font-mono text-[12px] text-text-3 tabular-nums">
            {plural(thread.replies, "resposta", "respostas")}
          </span>
          <time
            dateTime={new Date(thread.lastPostAt).toISOString()}
            className="text-right font-mono text-[11px] text-dim max-[700px]:col-span-2 max-[700px]:text-left"
          >
            {formatWhen(thread.lastPostAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

function Mark({ icon, label, tone }: { icon: ReactNode; label: string; tone: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 border border-line-2 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase ${tone}`}
    >
      {icon}
      {label}
    </span>
  );
}
