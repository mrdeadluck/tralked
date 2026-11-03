import type { ReactNode } from "react";

/** Lime condensed link for a panel or section head ("Ver biblioteca"). */
export const PANEL_LINK =
  "font-extrabold font-stretch-[80%] text-[12.5px] tracking-[0.05em] text-acc uppercase hover:underline hover:underline-offset-4";

type PanelProps = {
  title: string;
  /** Right of the title: a short note, or a link styled with PANEL_LINK. */
  aside?: ReactNode;
  /** Lime top rail instead of the graphite one (the panel that leads its group). */
  accent?: boolean;
  /** Id of the heading (aria-labelledby); derived from the title by default. */
  id?: string;
  className?: string;
  children: ReactNode;
};

const slug = (text: string) =>
  `p-${text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

/**
 * Graphite panel of the character sheet: the 45° cut on the top-right corner, a 2px rail along
 * the top and a condensed uppercase head.
 */
export function Panel({ title, aside, accent = false, id, className = "", children }: PanelProps) {
  const headingId = id ?? slug(title);
  return (
    <section
      aria-labelledby={headingId}
      className={`relative min-w-0 bg-surface p-[18px] tk-cut before:absolute before:top-0 before:right-[10px] before:left-0 before:h-[2px] before:content-[''] ${
        accent ? "before:bg-acc" : "before:bg-line-2"
      } ${className}`}
    >
      <PanelHead id={headingId} title={title} aside={aside} />
      {children}
    </section>
  );
}

/** The panel's head on its own, for cards that keep their own frame. */
export function PanelHead({ id, title, aside }: { id?: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-1.5">
      <h2 id={id} className="text-[17px] leading-tight font-extrabold font-stretch-[80%] tracking-[0.06em] uppercase">
        {title}
      </h2>
      {aside ? <div className="text-[13.5px] text-muted">{aside}</div> : null}
    </div>
  );
}

/** Thin bar: graphite track, dim lime fill (lime when `hot`: the top value or a 100%). */
export function Bar({ fraction, hot = false, className = "h-1.5" }: { fraction: number; hot?: boolean; className?: string }) {
  const width = Math.min(1, Math.max(0, fraction)) * 100;
  return (
    <span aria-hidden="true" className={`relative block overflow-hidden bg-track ${className}`}>
      <i
        className={`absolute inset-y-0 left-0 block transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] starting:w-0 ${
          hot ? "bg-acc" : "bg-acc-dim"
        }`}
        style={{ width: `${width.toFixed(1)}%` }}
      />
    </span>
  );
}

/** The "TRALKED!" stamp of a 100% game, with its count when known ("TRALKED! · 63/63"). */
export function TralkedStamp({ unlocked, total, className = "" }: { unlocked?: number; total?: number; className?: string }) {
  return (
    <span
      className={`inline-flex h-[22px] -rotate-3 items-center bg-acc px-[7px] text-[11.5px] font-black font-stretch-[112%] tracking-[0.02em] whitespace-nowrap text-acc-ink tabular-nums shadow-[2px_2px_0_rgba(0,0,0,.35)] ${className}`}
    >
      TRALKED!{total ? ` · ${unlocked ?? total}/${total}` : ""}
    </span>
  );
}
