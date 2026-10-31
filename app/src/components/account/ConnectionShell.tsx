import type { ReactNode } from "react";

export type ConnectionTone = "on" | "wait" | "off" | "error";

const TONE_CLASS: Record<ConnectionTone, string> = {
  on: "border-acc text-acc",
  wait: "border-rarity-lendario text-rarity-lendario",
  off: "border-line-2 text-dim",
  error: "border-nin text-nin",
};

/** The state badge of a connection ("Verificada", "Não conectada", "Em breve"…). */
export function ConnectionBadge({ status, tone }: { status: string; tone: ConnectionTone }) {
  return (
    <span className={`border px-2 py-1 font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap uppercase ${TONE_CLASS[tone]}`}>
      {status}
    </span>
  );
}

type ConnectionShellProps = {
  id: string;
  name: string;
  /** Platform color token, e.g. "var(--ps)". */
  color: string;
  status: string;
  tone: ConnectionTone;
  children: ReactNode;
};

/** One connection card on /conta/conexoes (Google login): name, state badge, then the state's content. */
export function ConnectionShell({ id, name, color, status, tone, children }: ConnectionShellProps) {
  return (
    <section aria-labelledby={`${id}-name`} className="rounded-[4px] border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id={`${id}-name`} className="flex items-center gap-3 text-[19px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          <span aria-hidden="true" className="size-2.5 flex-none" style={{ background: color }} />
          {name}
        </h2>
        <ConnectionBadge status={status} tone={tone} />
      </header>
      <div className="flex flex-col gap-4 px-5 py-5">{children}</div>
    </section>
  );
}
