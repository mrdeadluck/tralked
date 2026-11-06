"use client";

import { Suspense, use, useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { TabsMarks, TrophyMark, VersionTab, VersionTabTrophy } from "./version-views";

/*
 * "Troféus e conquistas", under the hero and its ficha: one tab per version of the game, each with
 * that version's trophy list. The public tabs (the first rows of each version) come once, in the
 * static shell; the player's marks (date, XP, the regional lists a trophy was earned in) stream in
 * as a small map read with `use`, and the rest of a list loads on "Ver a lista inteira" from the
 * cached game profile. Without JS the first panel shows, unmarked.
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
.vt-more button:disabled { color: var(--muted); cursor: progress; text-decoration: none; }
@media (max-width: 600px) {
  .vt-tr { grid-template-columns: 40px minmax(0, 1fr); padding-right: 10px; gap: 4px 10px; }
  .vt-ic { width: 40px; height: 40px; }
  .vt-r { grid-column: 2; text-align: left; display: flex; gap: 10px; align-items: baseline; }
  .vt-r b { margin: 0; }
}
`;

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** The rest of a version's list (after the rows the tab carries); null when it cannot be read. */
export type LoadMoreTrophies = (key: string) => Promise<VersionTabTrophy[] | null>;

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

/** `owned`: the player has this version (a trophy without a mark is "não obtido"). */
function TrophyRow({
  t,
  mark,
  owned,
  noun,
}: {
  t: VersionTabTrophy;
  mark: TrophyMark | null;
  owned: boolean;
  noun: VersionTab["noun"];
}) {
  const feminine = noun === "conquista";
  const name = mark?.reveal?.name ?? t.name;
  const description = mark?.reveal ? mark.reveal.description : t.description;
  const iconUrl = mark?.reveal ? mark.reveal.iconUrl : t.iconUrl;
  return (
    <li className="vt-tr" data-off={owned && !mark ? "" : undefined}>
      <span className="vt-ic">
        {iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconUrl} alt="" width={44} height={44} loading="lazy" />
        ) : (
          <TrophyIcon color={t.chip?.color ?? "var(--muted)"} />
        )}
      </span>
      <div>
        <h3>{name ?? (feminine ? "Conquista oculta" : "Troféu oculto")}</h3>
        <p>{name === null ? (feminine ? "Oculta até ser obtida." : "Oculto até ser obtido.") : description}</p>
        <div className="vt-tags">
          {t.chip ? (
            <span className="vt-tier" style={{ "--c": t.chip.color } as CSSProperties}>
              {t.chip.label}
            </span>
          ) : null}
          {t.share ? <span className="vt-share">{t.share}</span> : null}
          {mark?.lists.map((l) => <RegionChip key={l.label} label={l.label} date={l.date} />)}
          {mark && mark.lists.length > 0 ? (
            <span className="sr-only">{`obtido em: ${mark.lists.map((l) => `${l.label} (${l.date})`).join(", ")}`}</span>
          ) : null}
        </div>
      </div>
      <div className="vt-r">
        {mark ? (
          <>
            {mark.date}
            {mark.xp ? <b>{`+${fmt(mark.xp)} XP`}</b> : null}
          </>
        ) : owned ? (
          <span className="vt-no">{feminine ? "não obtida" : "não obtido"}</span>
        ) : null}
      </div>
      {mark?.why ? <p className="vt-why">{mark.why}</p> : null}
    </li>
  );
}

type Rest = VersionTabTrophy[] | "loading" | "failed";

function Panel({
  tab,
  marks,
  rest,
  open,
  onMore,
  id,
  labelledBy,
  hidden,
}: {
  tab: VersionTab;
  marks: TabsMarks["byKey"][string] | null;
  rest: Rest | undefined;
  open: boolean;
  onMore: () => void;
  id?: string;
  labelledBy?: string;
  hidden?: boolean;
}) {
  const loaded = Array.isArray(rest) ? rest : [];
  const shown = open ? [...tab.trophies, ...loaded] : tab.trophies;
  const role = labelledBy ? "tabpanel" : undefined;
  const meta = marks?.meta ?? { ...tab.meta, chips: [], note: null };
  return (
    <div className="vt-panel" role={role} id={id} aria-labelledby={labelledBy} tabIndex={role ? 0 : undefined} hidden={hidden}>
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
                <span className="vt-ok" aria-hidden="true">
                  ✓
                </span>
                <span className="sr-only">completa</span>
              </>
            ) : null}
          </span>
        ))}
        {meta.note ? <span>{meta.note}</span> : null}
      </p>
      <ul className="vt-list">
        {shown.map((t) => (
          <TrophyRow key={t.apiName} t={t} mark={marks?.earned[t.apiName] ?? null} owned={marks !== null} noun={tab.noun} />
        ))}
      </ul>
      {tab.count > tab.trophies.length ? (
        <p className="vt-more">
          <span>
            {rest === "failed" ? "Não foi possível carregar a lista agora." : `Mostrando ${fmt(shown.length)} de ${fmt(tab.count)}`}
          </span>
          <button type="button" aria-expanded={open} disabled={rest === "loading"} onClick={onMore}>
            {rest === "loading" ? "Carregando…" : open ? "Mostrar menos" : "Ver a lista inteira"}
          </button>
        </p>
      ) : null}
    </div>
  );
}

type TabsProps = {
  tabs: VersionTab[];
  /** The rest of each list, from the cached game profile (a bound Server Action on the page). */
  loadMore: LoadMoreTrophies;
  /** Accessible name of the tab list ("Versões de Grand Theft Auto V"). */
  label: string;
  /** The section heading ("Troféus e conquistas"). */
  title: string;
  /** The visitor's line beside the heading; the player's comes with the marks. */
  aside: string | null;
};

function Tabs({ tabs, marks, loadMore, label, title, aside }: TabsProps & { marks: TabsMarks | null }) {
  const base = useId();
  const first = marks && tabs.some((t) => t.key === marks.initial) ? marks.initial : (tabs[0]?.key ?? "");
  const [selected, setSelected] = useState(first);
  const [rest, setRest] = useState<Record<string, Rest>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tabId = (i: number) => `${base}-t${i}`;
  const panelId = (i: number) => `${base}-p${i}`;

  const more = (key: string) => {
    if (open[key]) {
      setOpen({ ...open, [key]: false });
      return;
    }
    setOpen({ ...open, [key]: true });
    if (Array.isArray(rest[key]) || rest[key] === "loading") return;
    setRest((r) => ({ ...r, [key]: "loading" }));
    loadMore(key).then(
      (rows) => setRest((r) => ({ ...r, [key]: rows ?? "failed" })),
      () => setRest((r) => ({ ...r, [key]: "failed" })),
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
    setSelected(tabs[next].key);
    document.getElementById(tabId(next))?.focus();
  };

  const panel = (t: VersionTab, extra?: { id: string; labelledBy: string; hidden: boolean }) => (
    <Panel
      key={t.key}
      tab={t}
      marks={marks?.byKey[t.key] ?? null}
      rest={rest[t.key]}
      open={Boolean(open[t.key])}
      onMore={() => more(t.key)}
      {...extra}
    />
  );
  const side = marks?.aside ?? aside;

  return (
    <section className="gp-veil" aria-labelledby={`${base}-h`}>
      <style href="tralked-game-version-tabs" precedence="default">
        {CSS}
      </style>
      <div className="gp-head">
        <h2 id={`${base}-h`}>{title}</h2>
        {side ? <span className="gp-aside">{side}</span> : null}
      </div>
      {tabs.length === 1 ? (
        panel(tabs[0])
      ) : (
        <>
          <div className="vt-tabs" role="tablist" aria-label={label}>
            {tabs.map((t, i) => {
              const on = t.key === selected;
              const mine = marks?.byKey[t.key];
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
                  {t.label === t.fullLabel ? null : <span className="sr-only"> ({t.fullLabel})</span>}
                  <span data-done={mine?.done ? "" : undefined}>{mine?.badge ?? t.badge}</span>
                </button>
              );
            })}
          </div>
          {tabs.map((t, i) => panel(t, { id: panelId(i), labelledBy: tabId(i), hidden: t.key !== selected }))}
        </>
      )}
    </section>
  );
}

function Marked({ marks, ...props }: TabsProps & { marks: Promise<TabsMarks | null> }) {
  const resolved = use(marks);
  return <Tabs {...props} marks={resolved} />;
}

/**
 * The tabs, unmarked until `marks` (the player's, per request) resolves; a visitor's resolves to
 * null. The public `tabs` are sent once and shared by both renders.
 */
export function VersionTabs({ marks, ...props }: TabsProps & { marks: Promise<TabsMarks | null> }) {
  if (props.tabs.length === 0) return null;
  return (
    <Suspense fallback={<Tabs {...props} marks={null} />}>
      <Marked {...props} marks={marks} />
    </Suspense>
  );
}
