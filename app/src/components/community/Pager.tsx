import Link from "next/link";

type PagerProps = {
  page: number;
  pageCount: number;
  /** Builds the link of a page number. */
  href: (page: number) => string;
  label: string;
};

/** Previous / "página X de Y" / next links (`?pagina=`). Nothing when there is a single page. */
export function Pager({ page, pageCount, href, label }: PagerProps) {
  if (pageCount <= 1) return null;
  const link =
    "inline-flex h-10 items-center rounded-[2px] border border-line-2 px-4 font-mono text-[11px] tracking-[0.08em] text-text-3 uppercase hover:border-text hover:text-text";
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 pt-6">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={link}>
          ← Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="font-mono text-[11px] text-dim tabular-nums">
        Página {page} de {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} rel="next" className={link}>
          Próxima →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** First value of a search param, parsed as a page number (default 1). */
export function pageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
