import { SectionHead } from "@/components/ui/SectionHead";
import type { GuideRevisionView } from "@/lib/queries/games";
import { timeAgo } from "./format";

export function Revisions({ revisions, now }: { revisions: GuideRevisionView[]; now: Date }) {
  if (revisions.length === 0) return null;
  return (
    <section id="g-rev" data-sec className="scroll-mt-24">
      <SectionHead title="Histórico de revisões" />
      <ul className="m-0 list-none p-0">
        {revisions.map((rev) => (
          <li
            key={rev.id}
            className="grid grid-cols-[70px_minmax(0,1fr)_auto] gap-4 border-b border-divider py-3.5 text-[15px] max-[640px]:grid-cols-[56px_minmax(0,1fr)]"
          >
            <b className="font-mono text-xs font-bold text-acc">{rev.version}</b>
            <span>{rev.summary}</span>
            <small className="font-mono text-[11px] whitespace-nowrap text-dim max-[640px]:col-start-2">
              {rev.authorHandle ? `@${rev.authorHandle}, ` : ""}
              {timeAgo(rev.createdAt, now)}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
