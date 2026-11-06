"use client";

import {
  createContext,
  Suspense,
  use,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { TabsMarks, VersionMarks, VersionTab, VersionTabTrophy } from "./version-views";

/*
 * "Troféus e conquistas", under the hero and its ficha: one tab per version of the game, each with
 * that version's trophy list. The public tabs (the first rows of each version) render once, in the
 * static shell; the player's marks (badge, meta line, date, XP, the regional lists a trophy was
 * earned in) stream in as a small map, read with `use` only by the small parts that show them, each
 * under its own Suspense (its fallback is the visitor's copy). "Ver a lista inteira" swaps the first
 * rows for the version's whole list, read from its own cache. Without JS the first panel shows,
 * unmarked.
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
.vt-tr:has(.vt-no) .vt-ic { background: var(--stripes); }
.vt-tr:has(.vt-no) .vt-ic svg, .vt-tr:has(.vt-no) .vt-ic img { opacity: .45; }
.vt-tr:has(.vt-no) .vt-ic img { filter: grayscale(1); }
.vt-tr:has(.vt-no) h3 { color: var(--text-2); }
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
.vt-more button:disabled { color: var(--muted); cursor: progress; text-decoration: none; }
@media (max-width: 600px) {
  .vt-tr { grid-template-columns: 40px minmax(0, 1fr); padding-right: 10px; gap: 4px 10px; }
  .vt-ic { width: 40px; height: 40px; }
  .vt-r { grid-column: 2; text-align: left; display: flex; gap: 10px; align-items: baseline; }
  .vt-r b { margin: 0; }
}
`;

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** A version's whole public list; null when it cannot be read. */
export type LoadMoreTrophies = (key: string) => Promise<VersionTabTrophy[] | null>;

/** The player's marks, per request; resolves to null for a visitor. */
const MarksContext = createContext<Promise<TabsMarks | null>>(Promise.resolve(null));

function MarksRender({ render }: { render: (marks: TabsMarks | null) => ReactNode }) {
  return <>{render(use(useContext(MarksContext)))}</>;
}

/** A mark-dependent part: `fallback` (the visitor's copy) until the marks arrive, then `render`. */
function WithMarks({ fallback = null, render }: { fallback?: ReactNode; render: (marks: TabsMarks | null) => ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <MarksRender render={render} />
    </Suspense>
  );
}

function TrophyIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v5a5 5 0 0 1-10 0z M10 14h4v3h3v3H7v-3h3z" style={{ fill: color }} />
    </svg>
  );
}

function Ok() {
  return (
    <span className="vt-ok" aria-hidden="true">
      ✓
    </span>
  );
}

/** The marks of one trophy: region chips (in the tags line) or date, XP and the XP note (row end). */
function RowMarks({ apiName, versionKey, noun, part }: { apiName: string; versionKey: string; noun: VersionTab["noun"]; part: "tags" | "end" }) {
  const empty = part === "end" ? <div className="vt-r" /> : null;
  return (
    <WithMarks
      fallback={empty}
      render={(marks) => {
        const mine = marks?.byKey[versionKey];
        const mark = mine?.earned[apiName];
        if (part === "tags") {
          if (!mark || mark.lists.length === 0) return null;
          return (
            <>
              {mark.lists.map((l) => (
                <span key={l.label} className="vt-chip" title={l.date ? `Obtido em ${l.date}` : undefined}>
                  {l.label}
                  <Ok />
                </span>
              ))}
              <span className="sr-only">{`obtido em: ${mark.lists.map((l) => `${l.label} (${l.date})`).join(", ")}`}</span>
            </>
          );
        }
        if (!mark) {
          return (
            <div className="vt-r">
              {mine ? <span className="vt-no">{noun === "conquista" ? "não obtida" : "não obtido"}</span> : null}
            </div>
          );
        }
        return (
          <>
            <div className="vt-r">
              {mark.date}
              {mark.xp ? <b>{`+${fmt(mark.xp)} XP`}</b> : null}
            </div>
            {mark.why ? <p className="vt-why">{mark.why}</p> : null}
          </>
        );
      }}
    />
  );
}

function TrophyRow({ t, versionKey, noun }: { t: VersionTabTrophy; versionKey: string; noun: VersionTab["noun"] }) {
  const feminine = noun === "conquista";
  const masked = (
    <>
      <h3>{feminine ? "Conquista oculta" : "Troféu oculto"}</h3>
      <p>{feminine ? "Oculta até ser obtida." : "Oculto até ser obtido."}</p>
    </>
  );
  return (
    <li className="vt-tr">
      <span className="vt-ic">
        {t.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.iconUrl} alt="" width={44} height={44} loading="lazy" />
        ) : (
          <TrophyIcon color={t.chip?.color ?? "var(--muted)"} />
        )}
      </span>
      <div>
        {t.name === null ? (
          // A hidden trophy: its text only for the player who earned it (from the marks).
          <WithMarks
            fallback={masked}
            render={(marks) => {
              const reveal = marks?.byKey[versionKey]?.earned[t.apiName]?.reveal;
              return reveal ? (
                <>
                  <h3>{reveal.name}</h3>
                  <p>{reveal.description}</p>
                </>
              ) : (
                masked
              );
            }}
          />
        ) : (
          <>
            <h3>{t.name}</h3>
            <p>{t.description}</p>
          </>
        )}
        <div className="vt-tags">
          {t.chip ? (
            <span className="vt-tier" style={{ "--c": t.chip.color } as CSSProperties}>
              {t.chip.label}
            </span>
          ) : null}
          {t.share ? <span className="vt-share">{t.share}</span> : null}
          <RowMarks apiName={t.apiName} versionKey={versionKey} noun={noun} part="tags" />
        </div>
      </div>
      <RowMarks apiName={t.apiName} versionKey={versionKey} noun={noun} part="end" />
    </li>
  );
}

function Meta({ tab, mine }: { tab: VersionTab; mine: VersionMarks | null }) {
  const meta = mine?.meta ?? { ...tab.meta, chips: [], note: null };
  return (
    <p className="vt-meta">
      <span>
        <b>{meta.strong}</b>
        {meta.rest}
      </span>
      {meta.chips.map((c) => (
        <span key={c.label} className="vt-chip">
          {c.label}
          {c.ok ? (
            <>
              <Ok />
              <span className="sr-only">completa</span>
            </>
          ) : null}
        </span>
      ))}
      {meta.note ? <span>{meta.note}</span> : null}
    </p>
  );
}

type Full = VersionTabTrophy[] | "loading" | "failed";

function Panel({
  tab,
  full,
  open,
  onMore,
  id,
  labelledBy,
  hidden,
}: {
  tab: VersionTab;
  full: Full | undefined;
  open: boolean;
  onMore: () => void;
  id?: string;
  labelledBy?: string;
  hidden?: boolean;
}) {
  // Opened, the whole list replaces the first rows: one snapshot, never two joined.
  const rows = open && Array.isArray(full) ? full : tab.trophies;
  const total = open && Array.isArray(full) ? full.length : tab.count;
  const role = labelledBy ? "tabpanel" : undefined;
  return (
    <div className="vt-panel" role={role} id={id} aria-labelledby={labelledBy} tabIndex={role ? 0 : undefined} hidden={hidden}>
      <WithMarks fallback={<Meta tab={tab} mine={null} />} render={(marks) => <Meta tab={tab} mine={marks?.byKey[tab.key] ?? null} />} />
      <ul className="vt-list">
        {rows.map((t) => (
          <TrophyRow key={t.apiName} t={t} versionKey={tab.key} noun={tab.noun} />
        ))}
      </ul>
      {tab.count > tab.trophies.length ? (
        <p className="vt-more">
          <span>
            {full === "failed" ? "Não foi possível carregar a lista agora." : `Mostrando ${fmt(rows.length)} de ${fmt(total)}`}
          </span>
          <button type="button" aria-expanded={open} disabled={full === "loading"} onClick={onMore}>
            {full === "loading" ? "Carregando…" : open ? "Mostrar menos" : "Ver a lista inteira"}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Opens the player's tab (the disc's version) once the marks arrive, unless a tab was already picked. */
function OpenInitial({ initial, onOpen }: { initial: string | null; onOpen: (key: string) => void }) {
  useEffect(() => {
    if (initial) onOpen(initial);
  }, [initial, onOpen]);
  return null;
}

type VersionTabsProps = {
  tabs: VersionTab[];
  /** The player's marks (per request; null for a visitor), read only by the parts that show them. */
  marks: Promise<TabsMarks | null>;
  /** A version's whole list, from its own cache (a bound Server Action on the page). */
  loadMore: LoadMoreTrophies;
  /** Accessible name of the tab list ("Versões de Grand Theft Auto V"). */
  label: string;
  /** The section heading ("Troféus e conquistas"). */
  title: string;
  /** The visitor's line beside the heading; the player's comes with the marks. */
  aside: string | null;
};

export function VersionTabs({ tabs, marks, loadMore, label, title, aside }: VersionTabsProps) {
  const base = useId();
  const [selected, setSelected] = useState(tabs[0]?.key ?? "");
  const picked = useRef(false);
  const [full, setFull] = useState<Record<string, Full>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openInitial] = useState(() => (key: string) => {
    if (!picked.current && tabs.some((t) => t.key === key)) setSelected(key);
  });
  if (tabs.length === 0) return null;
  const tabId = (i: number) => `${base}-t${i}`;
  const panelId = (i: number) => `${base}-p${i}`;
  const pick = (key: string) => {
    picked.current = true;
    setSelected(key);
  };

  const more = (key: string) => {
    if (open[key]) {
      setOpen({ ...open, [key]: false });
      return;
    }
    setOpen({ ...open, [key]: true });
    if (Array.isArray(full[key]) || full[key] === "loading") return;
    setFull((f) => ({ ...f, [key]: "loading" }));
    loadMore(key).then(
      (rows) => setFull((f) => ({ ...f, [key]: rows ?? "failed" })),
      () => setFull((f) => ({ ...f, [key]: "failed" })),
    );
  };

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
    pick(tabs[next].key);
    document.getElementById(tabId(next))?.focus();
  };

  const panel = (t: VersionTab, extra?: { id: string; labelledBy: string; hidden: boolean }) => (
    <Panel key={t.key} tab={t} full={full[t.key]} open={Boolean(open[t.key])} onMore={() => more(t.key)} {...extra} />
  );
  const visitorAside = aside ? <span className="gp-aside">{aside}</span> : null;

  return (
    <MarksContext value={marks}>
      <section className="gp-veil" aria-labelledby={`${base}-h`}>
        <style href="tralked-game-version-tabs" precedence="default">
          {CSS}
        </style>
        <WithMarks render={(m) => <OpenInitial initial={m?.initial ?? null} onOpen={openInitial} />} />
        <div className="gp-head">
          <h2 id={`${base}-h`}>{title}</h2>
          <WithMarks
            fallback={visitorAside}
            render={(m) => (m?.aside ? <span className="gp-aside">{m.aside}</span> : visitorAside)}
          />
        </div>
        {tabs.length === 1 ? (
          panel(tabs[0])
        ) : (
          <>
            <div className="vt-tabs" role="tablist" aria-label={label}>
              {tabs.map((t, i) => {
                const on = t.key === selected;
                const visitorBadge = <span>{t.badge}</span>;
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
                    onClick={() => pick(t.key)}
                    onKeyDown={onKeyDown}
                  >
                    {t.label}
                    {t.label === t.fullLabel ? null : <span className="sr-only"> ({t.fullLabel})</span>}
                    <WithMarks
                      fallback={visitorBadge}
                      render={(m) => {
                        const mine = m?.byKey[t.key];
                        return mine ? <span data-done={mine.done ? "" : undefined}>{mine.badge}</span> : visitorBadge;
                      }}
                    />
                  </button>
                );
              })}
            </div>
            {tabs.map((t, i) => panel(t, { id: panelId(i), labelledBy: tabId(i), hidden: t.key !== selected }))}
          </>
        )}
      </section>
    </MarksContext>
  );
}
