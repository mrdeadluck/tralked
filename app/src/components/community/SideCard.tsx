import type { ReactNode } from "react";

/** Side column card from the approved game page preview (.side-card). */
export function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-[4px] border border-line bg-surface p-5">
      <h2 className="text-[18px] leading-tight font-black font-stretch-[125%] tracking-[-0.02em] uppercase">{title}</h2>
      {children}
    </section>
  );
}
