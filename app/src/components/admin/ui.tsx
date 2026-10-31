import Link from "next/link";
import type { ReactNode } from "react";

/** Shared admin styles (Operate mode): dense, scannable, standard controls in the site identity. */

export const INPUT =
  "h-11 w-full rounded-[2px] border border-line-2 bg-bg px-3 text-[15px] text-text placeholder:text-ph hover:border-text-3 focus:border-text aria-invalid:border-nin";
export const TEXTAREA =
  "w-full resize-y rounded-[2px] border border-line-2 bg-bg px-3 py-2 text-[15px] leading-relaxed text-text placeholder:text-ph hover:border-text-3 focus:border-text aria-invalid:border-nin";
export const SELECT = `${INPUT} cursor-pointer pr-8`;
export const LABEL = "text-sm font-semibold text-text";
export const HINT = "text-[13px] text-muted";
export const SMALL_BUTTON =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[2px] border border-line-2 px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-text-2 uppercase hover:border-text hover:text-text disabled:cursor-not-allowed disabled:opacity-45";
export const TABLE = "w-full min-w-[720px] border-collapse text-left text-[14px]";
export const TH = "border-b border-line-2 px-3 py-2.5 font-mono text-[11px] font-normal tracking-[0.08em] text-dim uppercase";
export const TD = "border-b border-line px-3 py-3 align-top";

/** Section title of an admin page (h1) with an optional line and actions. */
export function AdminHead({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-text pb-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-[clamp(26px,3vw,36px)] leading-[0.95] font-black font-stretch-[125%] tracking-[-0.03em] uppercase">
          {title}
        </h1>
        {lede ? <p className="max-w-[72ch] text-[15px] text-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** h2 inside an admin page. */
export function AdminSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-2">
        <h2 className="text-[17px] leading-[1.1] font-black font-stretch-[125%] tracking-[-0.01em] uppercase">{title}</h2>
        {aside ? <div className="font-mono text-[11px] tracking-[0.06em] text-dim">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Horizontally scrollable table region (keyboard-focusable, named for screen readers). */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    // `relative`: the visually hidden header labels (position: absolute) stay clipped by the scroller.
    <div role="region" aria-label={label} tabIndex={0} className="relative overflow-x-auto">
      {children}
    </div>
  );
}

/** Compact select for filter bars (same height as the filter chips). */
export const FILTER_SELECT =
  "h-9 cursor-pointer rounded-[2px] border border-line-2 bg-bg px-2 text-[14px] text-text hover:border-text-3 focus:border-text";

/** Section tabs of a page (links), the current one underlined in the accent. */
export function TabLinks({ label, options }: { label: string; options: { href: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label}>
      <ul className="relative m-0 flex list-none gap-1 overflow-x-auto border-b border-line p-0">
        {options.map((o) => (
          <li key={o.href} className="flex-none">
            <Link
              href={o.href}
              aria-current={o.current ? "page" : undefined}
              className={`-mb-px flex min-h-11 items-center border-b-2 px-3.5 font-mono text-xs tracking-[0.08em] whitespace-nowrap uppercase ${
                o.current ? "border-acc text-text" : "border-transparent text-dim hover:text-text"
              }`}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Filter links (`?status=…`), the current one marked with aria-current. */
export function FilterLinks({
  label,
  options,
}: {
  label: string;
  options: { href: string; label: string; current: boolean; count?: number }[];
}) {
  return (
    <nav aria-label={label}>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {options.map((o) => (
          <li key={o.href}>
            <Link
              href={o.href}
              aria-current={o.current ? "page" : undefined}
              className={`inline-flex h-9 items-center gap-2 rounded-[2px] border px-3 font-mono text-[11px] tracking-[0.08em] uppercase ${
                o.current ? "border-acc bg-hover text-text" : "border-line-2 text-text-3 hover:border-text hover:text-text"
              }`}
            >
              {o.label}
              {o.count !== undefined ? <span className="text-muted tabular-nums">{o.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const TONE: Record<string, string> = {
  draft: "text-dim border-line-2",
  review: "text-rarity-lendario border-rarity-lendario/50",
  published: "text-acc border-acc/50",
  archived: "text-muted border-line-2",
  visible: "text-acc border-acc/50",
  open: "text-acc border-acc/50",
  locked: "text-ps border-ps/50",
  hidden: "text-rarity-lendario border-rarity-lendario/50",
  removed: "text-nin border-nin/50",
  deleted: "text-dim border-line-2",
  resolved: "text-acc border-acc/50",
  dismissed: "text-dim border-line-2",
  created: "text-acc border-acc/50",
  updated: "text-ps border-ps/50",
  rejected: "text-nin border-nin/50",
  revoked: "text-nin border-nin/50",
  active: "text-acc border-acc/50",
  bot: "text-ps border-ps/50",
  editorial: "text-text-3 border-line-2",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  published: "Publicado",
  archived: "Arquivado",
  visible: "Visível",
  open: "Aberto",
  locked: "Trancado",
  hidden: "Oculto",
  removed: "Removido",
  deleted: "Apagado pelo autor",
  resolved: "Resolvida",
  dismissed: "Descartada",
  created: "Criado",
  updated: "Atualizado",
  rejected: "Recusado",
  revoked: "Revogada",
  active: "Ativa",
  bot: "Robô",
  editorial: "Redação",
};

/** Small status label: text plus a 1px outline in the status color (never color alone). */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[10.5px] leading-none tracking-[0.08em] whitespace-nowrap uppercase ${
        TONE[status] ?? "text-text-3 border-line-2"
      }`}
    >
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** Fixed pt-BR date-time (same on server and client). */
export function When({ date }: { date: Date | null }) {
  if (!date) return <span className="text-dim">—</span>;
  return (
    <time dateTime={date.toISOString()} className="font-mono text-[12px] whitespace-nowrap text-text-3 tabular-nums">
      {DATE.format(date)}
    </time>
  );
}

/** Empty state of a list: what is missing and, when useful, what to do. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[2px] border border-dashed border-line-2 px-5 py-8">
      <p className="text-[15px] font-semibold">{title}</p>
      {children ? <p className="max-w-[64ch] text-[14px] text-muted">{children}</p> : null}
    </div>
  );
}

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
