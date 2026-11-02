import type { ReactNode } from "react";

/** One numbered-free section of a legal page: heading on the left, readable prose on the right. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="grid scroll-mt-24 gap-x-10 gap-y-3 border-b border-line pb-10 min-[801px]:grid-cols-[240px_minmax(0,1fr)]"
    >
      <h2
        id={`${id}-titulo`}
        className="text-[19px] leading-[1.1] font-black font-stretch-[125%] tracking-[-0.02em] uppercase"
      >
        {title}
      </h2>
      <div className="flex max-w-[68ch] min-w-0 flex-col gap-3 text-[16px] text-text-2 [&_a]:text-acc [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-text [&>ul]:m-0 [&>ul]:flex [&>ul]:list-disc [&>ul]:flex-col [&>ul]:gap-2 [&>ul]:pl-5 [&>ul>li]:pl-1 [&>ul>li]:text-pretty">
        {children}
      </div>
    </section>
  );
}

/** Small mono line under the page title ("Atualizada em ..."). */
export function LegalUpdated({ date }: { date: string }) {
  return <p className="font-mono text-xs tracking-[0.08em] text-dim uppercase">Atualizada em {date}</p>;
}
