import Link from "next/link";
import type { ReactNode } from "react";
import { AuthorBadge } from "@/components/community/AuthorBadge";
import { formatWhen } from "@/lib/community/format";
import type { PersonRow } from "@/lib/social/relations";

/** A list of players (followers, friends, requests, blocked) with an optional action per row. */
export function PersonList({
  people,
  label,
  empty,
  sinceLabel,
  action,
}: {
  people: PersonRow[];
  label: string;
  empty: string;
  /** "Segue desde", "Amigos desde"... */
  sinceLabel: string;
  action?: (person: PersonRow) => ReactNode;
}) {
  if (people.length === 0) return <p className="py-4 text-[15px] text-muted">{empty}</p>;
  return (
    <ul aria-label={label} className="m-0 grid list-none gap-px overflow-hidden rounded-[4px] border border-line bg-line p-0 min-[801px]:grid-cols-2">
      {people.map((person) => (
        <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <AuthorBadge author={{ ...person }} size={36} />
            <span className="pl-[46px] text-[13px] text-text-2">
              <Link href={`/jogador/${encodeURIComponent(person.handle)}`} className="hover:text-acc">
                {person.displayName}
              </Link>
              <span className="font-mono text-[10.5px] text-dim">
                {" "}
                · {sinceLabel} {formatWhen(person.since)}
              </span>
            </span>
          </div>
          {action ? action(person) : null}
        </li>
      ))}
    </ul>
  );
}
