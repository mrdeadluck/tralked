import Link from "next/link";
import {
  hrefWith,
  PAGE_PARAM,
  PER_PAGE_OPTIONS,
  PER_PAGE_PARAM,
  pageItems,
  type PageWindow,
} from "@/lib/pagination";

type PaginationProps = {
  /** Path of the list page (`/jogos`, `/jogador/x/jogos`). */
  basePath: string;
  /** The list's current URL state (filters, search, page size); every link keeps it. */
  params: Record<string, string | undefined>;
  window: Pick<PageWindow, "page" | "perPage" | "total" | "totalPages">;
  /** What is counted, e.g. ["jogo", "jogos"]. */
  noun?: [singular: string, plural: string];
  /** Accessible name of the navigation (several lists on a page need different names). */
  label?: string;
  /** Element id the page links jump to (a list below other content), e.g. "biblioteca". */
  anchor?: string;
};

const BOX =
  "inline-flex h-[34px] min-w-[34px] items-center justify-center rounded-[2px] border px-2.5 font-mono text-[11px] tracking-[0.06em] tabular-nums";
const IDLE = `${BOX} border-line-2 text-text-3 hover:border-dim hover:text-text`;
const CURRENT = `${BOX} border-text bg-text font-bold text-bg`;
const DISABLED = `${BOX} border-line text-dim-2`;

const nf = (n: number) => n.toLocaleString("pt-BR");

/**
 * Numbered pagination (first/previous/numbers with ellipses/next/last) plus the page size choice
 * (10/20/40/80). Plain links: works without JavaScript, and the state stays in the URL.
 */
export function Pagination({
  basePath,
  params,
  window,
  noun = ["item", "itens"],
  label = "Paginação",
  anchor,
}: PaginationProps) {
  const { page, perPage, total, totalPages } = window;
  if (total === 0) return null;
  const href = (changes: Record<string, string | number | undefined>) =>
    hrefWith(basePath, params, changes) + (anchor ? `#${anchor}` : "");
  const to = (n: number) => href({ [PAGE_PARAM]: n });
  const first = (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);

  const edge = (target: number, text: string, aria: string, enabled: boolean) =>
    enabled ? (
      <Link href={to(target)} aria-label={aria} className={IDLE}>
        {text}
      </Link>
    ) : (
      <span aria-hidden="true" className={DISABLED}>
        {text}
      </span>
    );

  return (
    <nav aria-label={label} className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p className="font-mono text-[11px] tracking-[0.06em] text-dim">
        {nf(first)}–{nf(last)} de {nf(total)} {total === 1 ? noun[0] : noun[1]}
      </p>

      {totalPages > 1 ? (
        <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li>{edge(1, "«", "Primeira página", page > 1)}</li>
          <li>{edge(page - 1, "‹ Anterior", "Página anterior", page > 1)}</li>
          {pageItems(page, totalPages).map((item, index) =>
            item === "gap" ? (
              <li key={`gap-${index}`} aria-hidden="true" className="px-1 font-mono text-[11px] text-dim">
                …
              </li>
            ) : (
              <li key={item}>
                {item === page ? (
                  <span aria-current="page" className={CURRENT}>
                    <span className="sr-only">Página </span>
                    {item}
                  </span>
                ) : (
                  <Link href={to(item)} aria-label={`Página ${item}`} className={IDLE}>
                    {item}
                  </Link>
                )}
              </li>
            ),
          )}
          <li>{edge(page + 1, "Próxima ›", "Próxima página", page < totalPages)}</li>
          <li>{edge(totalPages, "»", "Última página", page < totalPages)}</li>
        </ul>
      ) : null}

      {total > PER_PAGE_OPTIONS[0] ? (
        <div className="flex items-center gap-1.5" role="group" aria-label="Itens por página">
          <span aria-hidden="true" className="mr-1 font-mono text-[10.5px] tracking-[0.12em] text-dim-2 uppercase">
            Por página
          </span>
          {PER_PAGE_OPTIONS.map((size) =>
            size === perPage ? (
              <span key={size} aria-current="true" className={CURRENT}>
                {size}
                <span className="sr-only"> por página</span>
              </span>
            ) : (
              <Link
                key={size}
                href={href({ [PER_PAGE_PARAM]: size, [PAGE_PARAM]: undefined })}
                aria-label={`${size} por página`}
                className={IDLE}
              >
                {size}
              </Link>
            ),
          )}
        </div>
      ) : null}
    </nav>
  );
}
