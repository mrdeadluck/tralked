"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { VersionTab, VersionTabTrophy } from "./version-views";

/*
 * "Troféus e conquistas", under the hero and its ficha: one tab per version of the game, each with
 * that version's trophy list. A player's tabs carry their marks (date, XP, the regional lists a
 * trophy was earned in); a visitor's are the bare lists. Built on the server (version-views), so
 * this island only switches tabs and opens the whole list. Without JS the first panel shows.
 */

const CSS = `
.vt-tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: thin; }
.vt-tab { flex: none; display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 13px; border: 0; background: var(--surface); cursor: pointer; font: inherit; font-stretch: 80%; font-weight: 800; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-2); white-space: nowrap; }
.vt-tab::before { content: ""; width: 6px; height: 6px; background: var(--c, var(--muted)); }
.vt-tab > span { font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.vt-tab:hover { color: var(--text); background: var(--surface-2); }
.vt-tab[aria-selected="true"] { background: var(--hover-2); color: var(--text); box-shadow: inset 0 -2px 0 var(--acc); }
.vt-tab[aria-selected="true"] > span[data-done] { color: var(--gold); }
.vt-tab:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }
.vt-panel { margin-top: 10px; }
.vt-panel[hidden] { display: none; }
.vt-panel:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
.vt-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 12px; background: var(--surface); font-size: 13.5px; color: var(--text-2); margin-bottom: 2px; }
.vt-meta b { color: var(--text); }
.vt-chip { display: inline-flex; align-items: center; gap: 4px; min-height: 20px; padding: 0 6px; background: var(--track); font-stretch: 80%; font-weight: 750; font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-2); white-space: nowrap; }
.vt-ok { color: var(--acc); font-weight: 900; }
.vt-list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.vt-tr { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 4px 14px; align-items: start; padding: 9px 14px 9px 9px; background: var(--surface); }
.vt-tr:hover { background: var(--surface-2); }
.vt-ic { width: 44px; height: 44px; display: grid; place-items: center; overflow: hidden; background: var(--moss-2); }
.vt-ic img { width: 100%; height: 100%; object-fit: cover; }
.vt-ic svg { width: 20px; height: 20px; }
.vt-tr[data-off] .vt-ic { background: var(--stripes); }
.vt-tr[data-off] .vt-ic svg, .vt-tr[data-off] .vt-ic img { opacity: .45; }
.vt-tr[data-off] .vt-ic img { filter: grayscale(1); }
.vt-tr[data-off] h3 { color: var(--text-2); }
.vt-tr h3 { font-size: 15px; line-height: 1.25; font-weight: 700; }
.vt-tr p { margin-top: 1px; font-size: 13.5px; color: var(--muted); }
.vt-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 6px; }
.vt-tier { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 8px; background: var(--track); font-size: 12px; font-weight: 700; font-stretch: 80%; letter-spacing: .06em; text-transform: uppercase; color: var(--text-2); white-space: nowrap; }
.vt-tier::before { content: ""; width: 6px; height: 6px; flex: none; background: var(--c, var(--muted)); }
.vt-share { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.vt-r { text-align: right; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.vt-r b { display: block; margin-top: 2px; font-weight: 800; color: var(--acc); }
.vt-no { color: var(--dim); }
.vt-why { grid-column: 2 / -1; margin-top: 2px; padding: 7px 10px; background: color-mix(in oklch, var(--moss-2) 60%, transparent); font-size: 13px; color: var(--text-2); }
.vt-more { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 2px; padding: 10px 12px; background: var(--surface); font-size: 13px; color: var(--muted); }
.vt-more button { border: 0; padding: 0; background: none; cursor: pointer; font: inherit; color: var(--acc); font-stretch: 80%; font-weight: 750; font-size: 12.5px; letter-spacing: .05em; text-transform: uppercase; }
.vt-more button:hover { text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 600px) {
  .vt-tr { grid-template-columns: 40px minmax(0, 1fr); padding-right: 10px; gap: 4px 10px; }
  .vt-ic { width: 40px; height: 40px; }
  .vt-r { grid-column: 2; text-align: left; display: flex; gap: 10px; align-items: baseline; }
  .vt-r b { margin: 0; }
}
`;

/** Rows a panel shows before "Ver a lista inteira". */
const FIRST = 12;
const fmt = (n: number) => n.toLocaleString("pt-BR");

function TrophyIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v5a5 5 0 0 1-10 0z M10 14h4v3h3v3H7v-3h3z" style={{ fill: color }} />
    </svg>
  );
}

function RegionChip({ label, date }: { label: string; date: string }) {
  return (
    <span className="vt-chip" title={date ? `Obtido em ${date}` : undefined}>
      {label}
      <span className="vt-ok" aria-hidden="true">
        ✓
      </span>
    </span>
  );
}

function TrophyRow({ t, noun }: { t: VersionTabTrophy; noun: VersionTab["noun"] }) {
  const off = t.mark && !t.mark.earned;
  const feminine = noun === "conquista";
  return (
    <li className="vt-tr" data-off={off ? "" : undefined}>
      <span className="vt-ic">
        {t.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.iconUrl} alt="" width={44} height={44} loading="lazy" />
        ) : (
          <TrophyIcon color={t.chip?.color ?? "var(--muted)"} />
        )}
      </span>
      <div>
        <h3>{t.name ?? (feminine ? "Conquista oculta" : "Troféu oculto")}</h3>
        <p>{t.name === null ? (feminine ? "Oculta até ser obtida." : "Oculto até ser obtido.") : t.description}</p>
        <div className="vt-tags">
          {t.chip ? (
            <span className="vt-tier" style={{ "--c": t.chip.color } as CSSProperties}>
              {t.chip.label}
            </span>
          ) : null}
          {t.share ? <span className="vt-share">{t.share}</span> : null}
          {t.mark?.earned
            ? t.mark.lists.map((l) => <RegionChip key={l.label} label={l.label} date={l.date} />)
            : null}
          {t.mark?.earned && t.mark.lists.length > 0 ? (
            <span className="sr-only">{`obtido em: ${t.mark.lists.map((l) => `${l.label} (${l.date})`).join(", ")}`}</span>
          ) : null}
        </div>
      </div>
      <div className="vt-r">
        {t.mark?.earned ? (
          <>
            {t.mark.date}
            {t.mark.xp ? <b>{`+${fmt(t.mark.xp)} XP`}</b> : null}
          </>
        ) : t.mark ? (
          <span className="vt-no">{feminine ? "não obtida" : "não obtido"}</span>
        ) : null}
      </div>
      {t.mark?.earned && t.mark.why ? <p className="vt-why">{t.mark.why}</p> : null}
    </li>
  );
}

function Panel({ tab, id, labelledBy, hidden }: { tab: VersionTab; id?: string; labelledBy?: string; hidden?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? tab.trophies : tab.trophies.slice(0, FIRST);
  const role = labelledBy ? "tabpanel" : undefined;
  return (
    <div className="vt-panel" role={role} id={id} aria-labelledby={labelledBy} tabIndex={role ? 0 : undefined} hidden={hidden}>
      <p className="vt-meta">
        <span>
          <b>{tab.meta.strong}</b>
          {tab.meta.rest}
        </span>
        {tab.meta.chips.map((c) => (
          <span key={c.label} className="vt-chip">
            {c.label}
            {c.ok ? (
              <>
                <span className="vt-ok" aria-hidden="true">
                  ✓
                </span>
                <span className="sr-only">completa</span>
              </>
            ) : null}
          </span>
        ))}
        {tab.meta.note ? <span>{tab.meta.note}</span> : null}
      </p>
      <ul className="vt-list">
        {shown.map((t) => (
          <TrophyRow key={t.apiName} t={t} noun={tab.noun} />
        ))}
      </ul>
      {tab.trophies.length > FIRST ? (
        <p className="vt-more">
          <span>{`Mostrando ${fmt(shown.length)} de ${fmt(tab.trophies.length)}`}</span>
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Mostrar menos" : "Ver a lista inteira"}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function VersionTabs({
  tabs,
  initial,
  label,
  title,
  aside,
}: {
  tabs: VersionTab[];
  initial: string;
  /** Accessible name of the tab list ("Versões de Grand Theft Auto V"). */
  label: string;
  /** The section heading ("Troféus e conquistas"). */
  title: string;
  aside: string | null;
}) {
  const base = useId();
  const [selected, setSelected] = useState(tabs.some((t) => t.key === initial) ? initial : (tabs[0]?.key ?? ""));
  if (tabs.length === 0) return null;
  const tabId = (i: number) => `${base}-t${i}`;
  const panelId = (i: number) => `${base}-p${i}`;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.findIndex((t) => t.key === selected);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setSelected(tabs[next].key);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <section className="gp-veil" aria-labelledby={`${base}-h`}>
      <style href="tralked-game-version-tabs" precedence="default">
        {CSS}
      </style>
      <div className="gp-head">
        <h2 id={`${base}-h`}>{title}</h2>
        {aside ? <span className="gp-aside">{aside}</span> : null}
      </div>
      {tabs.length === 1 ? (
        <Panel tab={tabs[0]} />
      ) : (
        <>
          <div className="vt-tabs" role="tablist" aria-label={label}>
            {tabs.map((t, i) => {
              const on = t.key === selected;
              return (
                <button
                  key={t.key}
                  type="button"
                  className="vt-tab"
                  role="tab"
                  id={tabId(i)}
                  aria-controls={panelId(i)}
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  title={t.label === t.fullLabel ? undefined : t.fullLabel}
                  style={{ "--c": t.color } as CSSProperties}
                  onClick={() => setSelected(t.key)}
                  onKeyDown={onKeyDown}
                >
                  {t.label}
                  <span data-done={t.done ? "" : undefined}>{t.badge}</span>
                </button>
              );
            })}
          </div>
          {tabs.map((t, i) => (
            <Panel key={t.key} tab={t} id={panelId(i)} labelledBy={tabId(i)} hidden={t.key !== selected} />
          ))}
        </>
      )}
    </section>
  );
}
