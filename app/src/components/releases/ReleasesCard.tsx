"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent } from "react";
import { RELEASE_FILTERS, RELEASE_TABS, type ReleaseFilter, type ReleaseTab, type ReleasesCardData } from "@/lib/releases/view";
import { RELEASE_PLATFORM_COLOR, RELEASE_PLATFORM_LABEL } from "@/lib/releases/platforms";
import { ReleaseItem } from "./ReleaseItem";

const filterLabel = (f: ReleaseFilter) => (f === "TODAS" ? "Todas" : RELEASE_PLATFORM_LABEL[f]);

/**
 * Home card "Lançamentos": tabs Últimos (30 days) / Próximos (90 days) and a platform filter,
 * PC first. Server-rendered on "Últimos · PC", so it reads without JavaScript; the full list with
 * the same filters, also without JavaScript, is /lancamentos.
 */
export function ReleasesCard({ data }: { data: ReleasesCardData }) {
  const base = useId();
  const [tab, setTab] = useState<ReleaseTab>("ultimos");
  const [filter, setFilter] = useState<ReleaseFilter>("PC");
  const list = data.tabs[tab][filter];
  const tabId = (id: ReleaseTab) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;
  const consoleFilter = filter !== "PC" && filter !== "TODAS";

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = RELEASE_TABS.map((t) => t.id);
    const i = ids.indexOf(tab);
    const next =
      e.key === "ArrowRight" || e.key === "ArrowLeft"
        ? ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]
        : e.key === "Home"
          ? ids[0]
          : e.key === "End"
            ? ids[ids.length - 1]
            : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Lançamentos" className="flex gap-1 border-b border-line-2" onKeyDown={onTabKey}>
          {RELEASE_TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                id={tabId(t.id)}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={`h-10 px-3 font-mono text-[12px] tracking-[0.08em] uppercase focus-visible:outline-offset-[-2px] ${
                  on ? "text-text shadow-[inset_0_-2px_0_var(--acc)]" : "text-text-3 hover:text-text"
                }`}
              >
                {t.label}
                <span className="sr-only"> ({t.hint})</span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Plataforma" className="flex flex-wrap gap-1.5">
          {RELEASE_FILTERS.map((f) => {
            const on = f === filter;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f)}
                style={f === "TODAS" ? undefined : { borderColor: on ? RELEASE_PLATFORM_COLOR[f] : undefined }}
                className={`border px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] uppercase ${
                  on ? "border-text bg-hover text-text" : "border-line-2 text-text-3 hover:text-text"
                }`}
              >
                {filterLabel(f)}
              </button>
            );
          })}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {list.length === 1 ? "1 lançamento" : `${list.length} lançamentos`}: {filterLabel(filter)}
      </p>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
        {list.length > 0 ? (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-6 p-0">
            {list.map((release) => (
              <li key={release.gameId} className="border-b border-divider">
                <ReleaseItem release={release} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-[15px] text-muted">
            {consoleFilter && data.consolesOff
              ? "Os lançamentos de consoles ainda não estão ligados (falta configurar a integração com o IGDB)."
              : tab === "ultimos"
                ? "Nenhum lançamento nos últimos 30 dias nessa plataforma."
                : "Nenhum lançamento previsto para os próximos 90 dias nessa plataforma."}
          </p>
        )}
      </div>
      <Link
        href={`/lancamentos/${tab}/${filter.toLowerCase()}`}
        className="self-start font-mono text-xs tracking-[0.08em] text-acc uppercase hover:underline hover:underline-offset-4"
      >
        Todos os lançamentos →
      </Link>
    </div>
  );
}
