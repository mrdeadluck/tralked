"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { GameArt } from "@/components/art/GameArt";
import { isSafeHref } from "@/lib/content/url";
import type { NewsTab, StoryCard } from "@/lib/queries/news";

/*
 * News tabs of preview/tralked-jogo.html: sliding ink under the selected tab, animated panel swap
 * (out to the left, staggered in) and a magazine layout (lead + 2 secondary + "Mais lidas").
 * The grid follows its container width, so it fits the full page and the home column alike.
 * Server-rendered with the first tab already "in": readable without JS and with reduced motion.
 */

const CSS = `
.tkt { --mono: var(--font-jetbrains-mono), ui-monospace, Consolas, monospace; display: flex; flex-direction: column; gap: 26px; container-type: inline-size; }
.tkt-list { position: relative; display: flex; gap: 4px; border-bottom: 1px solid var(--border-2); overflow-x: auto; scrollbar-width: none; }
.tkt-list::-webkit-scrollbar { display: none; }
.tkt-tab { position: relative; height: 44px; padding: 0 14px; border: 0; background: none; font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); cursor: pointer; white-space: nowrap; }
.tkt-tab:hover, .tkt-tab[aria-selected="true"] { color: var(--text); }
.tkt-tab:focus-visible { outline-offset: -2px; }
.tkt-tab sup { font-size: 12px; letter-spacing: 0; color: var(--dim); margin-left: 5px; vertical-align: baseline; position: relative; top: -0.35em; }
.tkt:not([data-ready]) .tkt-tab[aria-selected="true"] { box-shadow: inset 0 -2px 0 var(--acc); }
.tkt-ink { position: absolute; bottom: 0; height: 2px; background: var(--acc); left: 0; width: 0; transition: left .45s cubic-bezier(.5,0,.2,1), width .45s cubic-bezier(.5,0,.2,1); }
.tkt-panel { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr) minmax(260px, .9fr); grid-template-rows: auto auto; gap: 18px 24px; }
.tkt-panel > * { opacity: 0; transform: translateY(18px); transition: opacity .55s ease, transform .55s cubic-bezier(.2,.8,.2,1); transition-delay: calc(var(--i, 0) * 70ms); }
.tkt-panel[data-phase="in"] > * { opacity: 1; transform: none; }
.tkt-panel[data-phase="out"] > * { opacity: 0; transform: translateX(-24px); transition-duration: .22s; transition-delay: 0s; }
.tkt-lead, .tkt-sec { position: relative; border-radius: 3px; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; background: var(--surface); }
.tkt-lead { grid-column: 1; grid-row: 1 / span 2; min-height: 440px; padding: 26px; }
.tkt-sec { grid-column: 2; min-height: 211px; padding: 16px; }
.tkt-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .8s cubic-bezier(.2,.8,.2,1); }
.tkt-lead:hover .tkt-art, .tkt-sec:hover .tkt-art { transform: scale(1.04); }
.tkt-lead::before, .tkt-sec::before { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(11,12,15,0) 30%, rgba(11,12,15,.95) 90%); }
.tkt-lead > :not(.tkt-art), .tkt-sec > :not(.tkt-art) { position: relative; z-index: 2; }
.tkt-lead h3 { font-weight: 900; font-stretch: 112%; font-size: clamp(28px, 3.2vw, 44px); line-height: .98; letter-spacing: -0.035em; margin: 12px 0 10px; }
.tkt-lead p { color: var(--text-2); max-width: 52ch; }
.tkt-sec h3 { font-weight: 800; font-stretch: 105%; font-size: 19px; line-height: 1.12; letter-spacing: -0.015em; margin-top: 8px; }
.tkt-meta { font-family: var(--mono); font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 8px; }
.tkt-kick { font-family: var(--mono); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--acc); }
.tkt-most { grid-column: 3; grid-row: 1 / span 2; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 20px; display: flex; flex-direction: column; }
.tkt-most h3 { font-weight: 900; font-stretch: 125%; font-size: 17px; text-transform: uppercase; letter-spacing: -0.02em; padding-bottom: 12px; border-bottom: 1px solid #23252c; }
.tkt-most ol { list-style: none; margin: 0; padding: 0; counter-reset: mr; }
.tkt-most li { counter-increment: mr; display: grid; grid-template-columns: 34px 1fr; gap: 10px; padding: 13px 0; border-bottom: 1px solid var(--divider); }
.tkt-most li:last-child { border-bottom: 0; }
.tkt-most li::before { content: counter(mr); font-weight: 900; font-stretch: 125%; font-size: 24px; line-height: 1; color: var(--dim); }
.tkt-most li:first-child::before { color: var(--acc); }
.tkt-most a { font-weight: 700; font-size: 14.5px; line-height: 1.25; }
.tkt-most a:hover { color: var(--acc); }
.tkt-most small { display: block; font-family: var(--mono); font-size: 12px; color: var(--dim); margin-top: 4px; }
.tkt-next { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; list-style: none; margin: 0; padding: 0; }
.tkt-next a { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); }
.tkt-next a:hover strong { color: var(--acc); }
.tkt-thumb { position: relative; flex: none; width: 112px; height: 64px; border-radius: 2px; overflow: hidden; }
.tkt-next span { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tkt-next strong { font-weight: 700; font-size: 14px; line-height: 1.25; }
.tkt-next small { font-family: var(--mono); font-size: 12px; color: var(--dim); }
.tkt-empty { grid-column: 1 / -1; padding: 40px 0; color: var(--muted); }
.tkt-more { grid-column: 1 / -1; justify-self: start; font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--acc); }
.tkt-more:hover { text-decoration: underline; text-underline-offset: 3px; }
.tkt-nolead .tkt-sec { grid-column: auto; grid-row: 1; min-height: 250px; }
@container (max-width: 600px) { .tkt-nolead .tkt-sec { grid-row: auto; min-height: 220px; } }
@container (max-width: 1000px) {
  .tkt-panel { grid-template-columns: 1fr 1fr; }
  .tkt-lead { grid-column: 1 / -1; grid-row: auto; min-height: 380px; }
  .tkt-sec { grid-column: auto; }
  .tkt-most { grid-column: 1 / -1; grid-row: auto; }
}
@container (max-width: 600px) {
  .tkt-panel { grid-template-columns: 1fr; }
  .tkt-lead { min-height: 340px; padding: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .tkt-ink, .tkt-panel > *, .tkt-art { transition: none; }
}
`;

type Phase = "in" | "out" | "pre";

function StoryLink({
  story,
  className,
  style,
  children,
}: {
  story: StoryCard;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // Never render an unsafe href; stories are also filtered before the panel is built.
  if (!isSafeHref(story.href, story.external)) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return story.external ? (
    <a href={story.href} target="_blank" rel="noopener noreferrer" className={className} style={style}>
      {children}
    </a>
  ) : (
    <Link href={story.href} className={className} style={style}>
      {children}
    </Link>
  );
}

function Meta({ story }: { story: StoryCard }) {
  return (
    <span className="tkt-meta">
      <span>{story.source}</span>
      <span>{story.when}</span>
      {story.external ? <span>abre em nova aba</span> : null}
    </span>
  );
}

const delay = (i: number) => ({ "--i": i }) as CSSProperties;

function Panel({
  tab,
  mostRead,
  mostReadTitle,
  withLead,
}: {
  tab: NewsTab;
  mostRead: StoryCard[];
  mostReadTitle: string;
  withLead: boolean;
}) {
  if (tab.stories.length === 0) {
    return <p className="tkt-empty">Nenhuma notícia nesta categoria ainda.</p>;
  }
  // Without a lead (the home, whose headline sits right above), the panel opens on two cards.
  const lead = withLead ? tab.stories[0] : null;
  const rest = withLead ? tab.stories.slice(1) : tab.stories;
  const secondary = rest.slice(0, 2);
  // Eleven stories in all: the lead, two secondary and a compact list of the next eight.
  const more = rest.slice(2, 10);
  return (
    <>
      {lead ? (
        <StoryLink story={lead} className="tkt-lead" style={delay(0)}>
          <GameArt
            className="tkt-art"
            seed={lead.seed}
            hues={lead.hues}
            imageUrl={lead.imageUrl}
            figure
            light
            width={900}
            height={640}
            sizes="(max-width: 1000px) calc(100vw - 40px), 640px"
          />
          <span className="tkt-kick">{lead.kicker}</span>
          <h3>{lead.title}</h3>
          {lead.excerpt ? <p>{lead.excerpt}</p> : null}
          <Meta story={lead} />
        </StoryLink>
      ) : null}
      {secondary.map((story, i) => (
        <StoryLink key={story.id} story={story} className="tkt-sec" style={delay(i + 1)}>
          <GameArt
            className="tkt-art"
            seed={story.seed}
            hues={story.hues}
            imageUrl={story.imageUrl}
            figure={i === 0}
            width={520}
            height={320}
            sizes="(max-width: 1000px) 50vw, 420px"
          />
          <span className="tkt-kick">{story.kicker}</span>
          <h3>{story.title}</h3>
          <Meta story={story} />
        </StoryLink>
      ))}
      {Array.from({ length: 2 - secondary.length }, (_, i) => (
        <div key={`gap-${i}`} className="tkt-sec" style={{ visibility: "hidden" }} aria-hidden="true" />
      ))}
      {more.length > 0 ? (
        <ul className="tkt-next" style={delay(3)}>
          {more.map((story) => (
            <li key={story.id}>
              <StoryLink story={story}>
                <GameArt className="tkt-thumb" seed={story.seed} hues={story.hues} imageUrl={story.imageUrl} width={224} height={128} sizes="112px" />
                <span>
                  <small>{story.kicker}</small>
                  <strong>{story.title}</strong>
                  <small>{story.when}</small>
                </span>
              </StoryLink>
            </li>
          ))}
        </ul>
      ) : null}
      {mostRead.length > 0 ? (
        <div className="tkt-most" style={delay(3)}>
          <h3>{mostReadTitle}</h3>
          <ol>
            {mostRead.map((story) => (
              <li key={story.id}>
                <span>
                  <StoryLink story={story}>{story.title}</StoryLink>
                  <small>
                    {story.kicker} · {story.when}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {tab.moreHref ? (
        <Link href={tab.moreHref} className="tkt-more" style={delay(4)}>
          Ver todas{tab.id === "ultimas" ? "" : ` em ${tab.label}`} →
        </Link>
      ) : null}
    </>
  );
}

const safeStories = (stories: StoryCard[]) => stories.filter((s) => isSafeHref(s.href, s.external));

export function NewsTabs({
  tabs: allTabs,
  mostRead: allMostRead,
  mostReadTitle = "Mais lidas",
  label = "Categorias de notícias",
  withLead = true,
}: {
  tabs: NewsTab[];
  mostRead: StoryCard[];
  mostReadTitle?: string;
  /** Accessible name of the tab list. */
  label?: string;
  /** Open each panel on a big lead story (false where a headline already sits above). */
  withLead?: boolean;
}) {
  // A category with nothing in it is not offered ("Comunidade 0"); the first tab always stays.
  const tabs = allTabs
    .map((tab) => ({ ...tab, stories: safeStories(tab.stories) }))
    .filter((tab, i) => i === 0 || tab.stories.length > 0);
  const mostRead = safeStories(allMostRead);
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState(tabs[0]?.id ?? "");
  const [shown, setShown] = useState(selected);
  const [phase, setPhase] = useState<Phase>("in");

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;

  const moveInk = useCallback(() => {
    const button = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const ink = inkRef.current;
    if (!button || !ink) return;
    // Until this runs (no JS yet) the selected tab carries a static underline instead of the ink.
    ink.parentElement?.parentElement?.setAttribute("data-ready", "");
    ink.style.left = `${button.offsetLeft}px`;
    ink.style.width = `${button.offsetWidth}px`;
  }, []);

  useLayoutEffect(moveInk, [selected, moveInk]);
  useEffect(() => {
    window.addEventListener("resize", moveInk);
    document.fonts?.ready.then(moveInk);
    return () => window.removeEventListener("resize", moveInk);
  }, [moveInk]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const select = (id: string, focus = false) => {
    if (focus) document.getElementById(tabId(id))?.focus();
    if (id === selected) return;
    setSelected(id);
    if (timer.current) clearTimeout(timer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(id);
      setPhase("in");
      return;
    }
    setPhase("out");
    timer.current = setTimeout(() => {
      setShown(id);
      setPhase("pre");
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase("in")));
    }, 230);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(selected);
    const next =
      e.key === "ArrowRight"
        ? ids[(i + 1) % ids.length]
        : e.key === "ArrowLeft"
          ? ids[(i - 1 + ids.length) % ids.length]
          : e.key === "Home"
            ? ids[0]
            : e.key === "End"
              ? ids[ids.length - 1]
              : null;
    if (next) {
      e.preventDefault();
      select(next, true);
    }
  };

  const current = tabs.find((t) => t.id === shown) ?? tabs[0];
  if (!current) return null;

  return (
    <div className="tkt">
      <style href="tralked-news-tabs" precedence="default">
        {CSS}
      </style>
      <div ref={listRef} className="tkt-list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const on = tab.id === selected;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              className="tkt-tab"
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              onClick={() => select(tab.id)}
            >
              {tab.label}
              <sup aria-hidden="true">{tab.stories.length}</sup>
              <span className="sr-only">
                , {tab.stories.length} {tab.stories.length === 1 ? "notícia" : "notícias"}
              </span>
            </button>
          );
        })}
        <span ref={inkRef} className="tkt-ink" aria-hidden="true" />
      </div>
      <div
        id={panelId}
        className={withLead ? "tkt-panel" : "tkt-panel tkt-nolead"}
        role="tabpanel"
        aria-labelledby={tabId(current.id)}
        data-phase={phase}
      >
        <Panel tab={current} mostRead={mostRead} mostReadTitle={mostReadTitle} withLead={withLead} />
      </div>
    </div>
  );
}
