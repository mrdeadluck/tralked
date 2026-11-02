"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { LinkChips, type LinkChip } from "@/components/ui/LinkChips";

type ChipGroup = { options: LinkChip[]; current: string };

type CatalogFiltersProps = {
  /** "Todos", "Quase 100%", "Com guia completo", then the genres. */
  categories: ChipGroup;
  /** How many category chips lead (the non-genre ones); the genres follow. */
  leading: number;
  platforms: ChipGroup;
  sorts: ChipGroup;
  /** Active filters (category, platform): the "Filtrar (n)" count. */
  activeCount: number;
  /** Games matching the current filters ("Ver 1.234 jogos"). */
  total: number;
  /** The catalog with no filter (the search kept). */
  clearHref: string;
};

/** Genres shown before "Mais gêneros" on wide screens. */
const GENRES_SHOWN = 6;

const GROUP_TITLE = "font-mono text-xs tracking-[0.12em] text-dim-2 uppercase";

/**
 * The catalog's filters. Wide screens: the chip bar, with the genres past the first six behind
 * "Mais gêneros". Phones: one "Filtrar (n)" button that opens every filter in a bottom sheet, so the
 * first covers show on the first screen. Every chip is a link (the state lives in the URL).
 */
export function CatalogFilters({ categories, leading, platforms, sorts, activeCount, total, clearHref }: CatalogFiltersProps) {
  const [moreGenres, setMoreGenres] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const sheetTitle = useId();

  const lead = categories.options.slice(0, leading);
  const genres = categories.options.slice(leading);
  const hiddenGenres = genres.slice(GENRES_SHOWN);
  // A selected genre is never hidden behind "Mais gêneros".
  const currentHidden = hiddenGenres.some((g) => g.id === categories.current);
  const shownGenres = moreGenres || currentHidden ? genres : genres.slice(0, GENRES_SHOWN);
  // What is applied, next to the phone button: "Soulslike · PlayStation · Ordem: Nome".
  const summary = [
    categories.current !== categories.options[0]?.id
      ? categories.options.find((o) => o.id === categories.current)?.label
      : null,
    platforms.current !== platforms.options[0]?.id
      ? platforms.options.find((o) => o.id === platforms.current)?.label
      : null,
    `Ordem: ${sorts.options.find((o) => o.id === sorts.current)?.label ?? ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const totalLabel = `${total.toLocaleString("pt-BR")} ${total === 1 ? "jogo" : "jogos"}`;

  return (
    <>
      {/* Wide screens: the bar. */}
      <div className="flex flex-col gap-3 max-md:hidden">
        <LinkChips
          label="Filtrar jogos"
          options={[...lead, ...shownGenres]}
          current={categories.current}
          trailing={
            hiddenGenres.length > 0 && !currentHidden ? (
            <button
              type="button"
              aria-expanded={moreGenres}
              onClick={() => setMoreGenres((v) => !v)}
              className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[2px] border border-dashed border-line-2 px-3 font-mono text-xs tracking-[0.08em] text-text-3 uppercase transition-colors duration-150 hover:border-dim hover:text-text"
            >
              {moreGenres ? "Menos gêneros" : `Mais gêneros (${hiddenGenres.length})`}
            </button>
            ) : null
          }
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <LinkChips label="Filtrar por plataforma" caption="Plataforma" options={platforms.options} current={platforms.current} />
          <LinkChips label="Ordenar jogos" caption="Ordenar" options={sorts.options} current={sorts.current} />
        </div>
      </div>

      {/* Phones: one button, every filter in a bottom sheet. */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => sheet.current?.showModal()}
          className={`inline-flex h-11 cursor-pointer items-center gap-2.5 rounded-[2px] border px-4 font-mono text-xs font-bold tracking-[0.1em] uppercase transition-colors duration-150 ${
            activeCount > 0 ? "border-acc text-acc" : "border-line-2 text-text hover:border-text"
          }`}
        >
          <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="square">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filtrar{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
        <span className="min-w-0 truncate font-mono text-xs tracking-[0.06em] text-dim uppercase">
          {summary}
        </span>
      </div>

      <dialog
        ref={sheet}
        aria-labelledby={sheetTitle}
        onClick={(e) => {
          // A tap on the backdrop (the dialog box itself, outside the panel) closes the sheet.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-[8px] border border-b-0 border-line-2 bg-surface p-0 text-text shadow-[0_-24px_48px_-24px_rgba(0,0,0,.9)] transition-[translate] duration-300 ease-[cubic-bezier(.16,1,.3,1)] backdrop:bg-black/60 starting:open:translate-y-full motion-reduce:transition-none md:hidden"
      >
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2">
            <span aria-hidden="true" className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-2" />
            <h2 id={sheetTitle} className="pt-2 text-[20px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
              Filtros
            </h2>
            <button
              type="button"
              onClick={() => sheet.current?.close()}
              aria-label="Fechar filtros"
              className="grid size-11 cursor-pointer place-items-center rounded-[2px] text-text-3 hover:text-text"
            >
              <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="square">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="flex flex-col gap-6 overflow-y-auto overscroll-contain px-5 py-5">
            <section className="flex flex-col gap-2.5">
              <h3 className={GROUP_TITLE}>Mostrar</h3>
              <LinkChips label="Filtrar jogos" options={lead} current={categories.current} />
            </section>
            <section className="flex flex-col gap-2.5">
              <h3 className={GROUP_TITLE}>Gênero</h3>
              <LinkChips label="Filtrar por gênero" options={genres} current={categories.current} />
            </section>
            <section className="flex flex-col gap-2.5">
              <h3 className={GROUP_TITLE}>Plataforma</h3>
              <LinkChips label="Filtrar por plataforma" options={platforms.options} current={platforms.current} />
            </section>
            <section className="flex flex-col gap-2.5">
              <h3 className={GROUP_TITLE}>Ordenar</h3>
              <LinkChips label="Ordenar jogos" options={sorts.options} current={sorts.current} />
            </section>
          </div>
          <div className="flex items-center gap-3 border-t border-line px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {activeCount > 0 ? (
              <Link
                href={clearHref}
                scroll={false}
                className="inline-flex h-11 items-center px-1 font-mono text-xs tracking-[0.1em] text-text-3 uppercase underline-offset-4 hover:text-text hover:underline"
              >
                Limpar
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => sheet.current?.close()}
              className="ml-auto inline-flex h-11 flex-1 cursor-pointer items-center justify-center rounded-[2px] border border-acc bg-acc px-5 font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase"
            >
              Ver {totalLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
