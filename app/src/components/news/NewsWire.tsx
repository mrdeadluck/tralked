"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { isSafeHref } from "@/lib/content/url";
import type { WireItem } from "@/lib/queries/news";
import { WireCard } from "./WireCard";

/*
 * "Em circulação": the moving news wire of preview/tralked-jogo.html. The card in focus rests
 * exactly inside the fixed central frame; every few seconds the strip glides one card left and
 * the next one settles in the frame (it never drifts between positions, so the frame always
 * holds a card). Pause button, drag, arrows (buttons and keyboard), and it stops on hover, on
 * keyboard focus and when off screen.
 * Reduced motion: starts paused and moves instantly instead of gliding.
 * Without JS it is a static, scrollable-by-focus row of links.
 */

/** How long a card rests in the frame before the next one glides in. */
const DWELL_MS = 4200;
const GLIDE_MS = 700;
const GAP = 18;

// Colors below are the approved preview's paper/ink tones for the wire cards only.
const CSS = `
.tkw { --wire-bg: #17171a; --paper: var(--text); --paper-hi: #f6f5ef; --ink: var(--bg); --ink-2: #464950; --acc-ink: #4f6a00;
  --mono: var(--font-jetbrains-mono), ui-monospace, Consolas, monospace;
  position: relative; width: 100vw; margin-left: calc(50% - 50vw); background: var(--wire-bg);
  border-block: 1px solid var(--border); padding: 48px 0 30px; overflow: clip; }
body:has(.tkw) { overflow-x: clip; }
.tkw-head { max-width: 1320px; margin: 0 auto; padding: 0 20px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.tkw-head h2 { font-weight: 900; font-stretch: 125%; font-size: 26px; line-height: 1; letter-spacing: -0.03em; text-transform: uppercase; }
.tkw-head p { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.tkw-stage { position: relative; padding: 46px 0; cursor: grab; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.tkw-stage[data-dragging] { cursor: grabbing; }
.tkw-compact .tkw-stage { zoom: .55; }
.tkw-compact { padding-block: 24px; }
.tkw-track { display: flex; gap: ${GAP}px; width: max-content; will-change: transform; }
.tkw-lens { position: absolute; left: 50%; top: 50%; width: 330px; height: 404px; translate: -50% -50%; border: 1px solid rgba(236,236,230,.22); border-radius: 22px; pointer-events: none; z-index: 2; }
.tkw-lens::after { content: ""; position: absolute; left: 50%; bottom: -14px; width: 6px; height: 6px; translate: -50% 0; background: var(--acc); }
.tkw-foot { max-width: 1320px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.tkw-pause { width: 40px; height: 40px; border-radius: 2px; border: 0; background: var(--text); color: var(--bg); display: grid; place-items: center; cursor: pointer; flex: none; }
.tkw-pause:hover { background: var(--acc); }
.tkw-pause svg { width: 14px; height: 14px; }
.tkw-nav { display: flex; gap: 6px; flex: none; }
.tkw-btn { width: 36px; height: 36px; border: 1px solid var(--border-2); background: var(--surface-2); color: var(--text); border-radius: 2px; display: grid; place-items: center; cursor: pointer; }
.tkw-btn:hover { border-color: var(--text); }
.tkw-btn svg { width: 16px; height: 16px; }
.tkw-focus { font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tkw-focus b { color: var(--text); font-weight: 500; }

.tkw-card { flex: 0 0 300px; height: 370px; position: relative; border-radius: 2px; overflow: hidden; display: flex; flex-direction: column; transform: scale(.93); filter: saturate(.7) brightness(.84); transition: transform .6s cubic-bezier(.2,.8,.2,1), filter .6s; -webkit-user-drag: none; }
.tkw-card[data-focus] { transform: scale(1); filter: none; }
.tkw-card:focus-visible { outline: 2px solid var(--acc); outline-offset: 4px; }
.tkw-art { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.tkw-arrow { position: absolute; right: 10px; bottom: 10px; width: 16px; height: 16px; z-index: 2; }
.tkw-brand { display: inline-flex; line-height: 1; }
.tkw-brand svg { height: .72em; width: auto; }
.tkw-meta { font-family: var(--mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
.tkw-leader { display: flex; gap: 4px; align-items: baseline; font-family: var(--mono); font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
.tkw-leader i { flex: 1; border-bottom: 1px dotted currentColor; opacity: .5; transform: translateY(-3px); }
.tkw-hl { font-weight: 500; font-size: 22px; line-height: 1.02; letter-spacing: -0.015em; text-transform: uppercase; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }

.tkw-paper { background: var(--paper); color: var(--ink); padding: 14px; gap: 12px; }
.tkw-paper .tkw-img { position: relative; margin-left: auto; width: 74%; flex: 1; min-height: 0; overflow: hidden; }
.tkw-paper .tkw-meta { color: var(--ink-2); }

.tkw-block { background: var(--paper); color: var(--ink); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.tkw-block .tkw-a1 { grid-column: 1; grid-row: 1; padding: 14px; min-width: 0; }
.tkw-block .tkw-a1 .tkw-hl { color: var(--acc-ink); }
.tkw-block .tkw-a2 { grid-column: 2; grid-row: 1; background: var(--acc); }
.tkw-block .tkw-a3 { grid-column: 1; grid-row: 2; background: var(--acc); display: flex; align-items: flex-end; padding: 12px; }
.tkw-block .tkw-a3 .tkw-brand { --wordmark-k: var(--ink); }
.tkw-block .tkw-a4 { grid-column: 2; grid-row: 2; padding: 12px; display: flex; flex-direction: column; justify-content: center; gap: 10px; background: var(--paper-hi); border-top-left-radius: 14px; margin: -14px 0 0 -14px; min-width: 0; }
.tkw-block .tkw-a4 b { font-weight: 500; font-size: 12px; line-height: 1.1; text-transform: uppercase; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.tkw-block .tkw-a4 .tkw-leader { color: var(--acc-ink); margin-top: 3px; }
.tkw-block .tkw-mark { position: absolute; left: 13%; top: 37%; width: 18%; aspect-ratio: 1; border: 6px solid rgba(11,12,15,.08); }

.tkw-newp { background: var(--paper); color: var(--ink); }
.tkw-newp .tkw-top { padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start; }
.tkw-newp .tkw-thin { font-weight: 300; font-stretch: 100%; font-size: 21px; line-height: .9; color: var(--ink-2); letter-spacing: -0.02em; white-space: pre-line; flex: none; }
.tkw-newp .tkw-top .tkw-hl { font-weight: 700; font-size: 21px; -webkit-line-clamp: 3; }
.tkw-newp .tkw-img { position: relative; flex: 1; min-height: 0; }
.tkw-newp .tkw-img .tkw-meta { position: absolute; left: 12px; right: 36px; bottom: 34px; color: var(--paper); opacity: .85; }
.tkw-newp .tkw-img .tkw-brand { position: absolute; left: 12px; bottom: 10px; font-size: 16px; color: var(--paper); }
.tkw-newp .tkw-arrow { color: var(--paper); }

.tkw-portrait { background: var(--bg); color: var(--text); }
.tkw-portrait .tkw-art { filter: grayscale(1) contrast(1.15); position: absolute; inset: 0; }
.tkw-portrait .tkw-tag { position: absolute; left: 50%; top: 46%; translate: -50% 0; max-width: 84%; width: max-content; text-align: center; font-family: var(--mono); font-size: 12px; line-height: 1.4; background: rgba(236,236,230,.92); color: var(--ink); padding: 2px 6px; letter-spacing: .08em; text-transform: uppercase; }
.tkw-portrait .tkw-giant { position: absolute; left: -4px; right: -40px; bottom: -10px; font-weight: 900; font-stretch: 125%; font-size: 66px; line-height: .85; letter-spacing: -0.04em; color: rgba(236,236,230,.86); mix-blend-mode: difference; white-space: nowrap; text-transform: none; }

.tkw-dark { background: var(--bg); color: var(--text); }
.tkw-dark .tkw-hl { margin: 14px; font-weight: 600; font-size: 25px; -webkit-line-clamp: 3; }
.tkw-dark .tkw-img { position: relative; flex: 1; min-height: 0; }
.tkw-dark .tkw-img .tkw-meta { position: absolute; left: 14px; right: 36px; bottom: 12px; color: var(--text-2); }

@media (max-width: 600px) { .tkw-lens { display: none; } }
/* Without JS the strip cannot move: drop the loop copies and let it scroll, so focused cards stay visible. */
@media (scripting: none) {
  .tkw-copy { display: none; }
  .tkw-stage { overflow-x: auto; cursor: auto; padding-inline: 20px; }
  .tkw-card { transform: none; filter: none; }
}
@media (prefers-reduced-motion: reduce) { .tkw-card { transition: none; } }
`;

type Glide = { from: number; to: number; t0: number };

/**
 * Copies of the cards needed on EACH side of the originals for a seamless loop: with any original
 * centred, the strip must still reach past both edges of the stage (half a stage plus half a card
 * and a gap on either side). One copy is enough for long lists; a short list on a wide screen needs
 * more, or the end of the strip shows (and then jumps) before it wraps.
 */
export function copiesNeeded(stageWidth: number, cardWidth: number, period: number): number {
  if (period <= 0 || stageWidth <= 0) return 1;
  return Math.max(1, Math.ceil((stageWidth / 2 + cardWidth / 2 + GAP) / period));
}

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeReduce = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const readReduce = () => window.matchMedia(REDUCE_QUERY).matches;

export function NewsWire({
  items: allItems,
  title = "Em circulação",
  description,
  label = "Notícias em movimento",
  className = "",
}: {
  items: WireItem[];
  title?: string;
  description?: string;
  /** Accessible name of the carousel. */
  label?: string;
  className?: string;
}) {
  // Defense in depth: the queries already drop unsafe feed URLs.
  const items = allItems.filter((item) => isSafeHref(item.href, item.external));
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduce = useSyncExternalStore(subscribeReduce, readReduce, () => false);
  /** null until the user presses the button: reduced motion starts paused. */
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? reduce;
  const pausedRef = useRef(paused);
  const [focused, setFocused] = useState<{ kicker: string; title: string } | null>(
    items[0] ? { kicker: items[0].kicker, title: items[0].title } : null,
  );
  /** Imperative API filled by the animation effect (the arrow buttons call into it). */
  const api = useRef<{ step: (dir: 1 | -1) => void } | null>(null);
  /** Copies of the cards on each side of the originals (see `copiesNeeded`). */
  const [sides, setSides] = useState(1);
  /** Position relative to "first original centred", kept when the copies are rebuilt. */
  const phase = useRef<number | null>(null);
  const count = items.length;
  const itemsKey = items.map((i) => i.id).join("|");

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!stage || !track || count === 0) return;

    // [hidden copies × sides][originals][hidden copies × sides]. Only the originals take focus; the
    // copies on both sides let any original sit centred while the strip still covers the stage edge
    // to edge, so the loop never shows its end: it wraps by exactly one copy, an identical picture.
    const cards = Array.from(track.children) as HTMLElement[];
    /** Index of the first original card. */
    const first = sides * count;
    let x = 0;
    let hover = false;
    let focusInside = false;
    let visible = true;
    let drag: { x0: number; start: number; moved: number; id: number } | null = null;
    let glide: Glide | null = null;
    let last = 0;
    /** Time the focused card has rested in the frame (ms). */
    let rest = 0;
    let current: HTMLElement | null = null;
    let frame = 0;
    // Card geometry relative to the track (transforms don't change it); refreshed on resize.
    let geo: { left: number; width: number }[] = [];
    /** Width of one copy (cards + gaps): the loop period. */
    let period = 0;
    const measure = () => {
      geo = cards.map((c) => ({ left: c.offsetLeft, width: c.offsetWidth }));
      period = (track.scrollWidth + GAP) / (2 * sides + 1);
    };
    measure();
    /** Offset that centres card i under the lens. */
    const centred = (i: number) => stage.clientWidth / 2 - geo[i].left - geo[i].width / 2;
    // Start with the originals where the first copy is (same picture as the server render), or
    // where the strip was before its copies were rebuilt.
    x = phase.current === null ? -sides * period : centred(first) + phase.current;

    /**
     * Keeps x in (top - period, top], where `top` centres the first original. Every original's
     * centred offset lies in that window, so a focused card is the one on screen, not a copy.
     */
    const wrap = () => {
      if (period <= 0) return;
      const top = centred(first);
      while (x <= top - period) x += period;
      while (x > top) x -= period;
    };
    /** More copies when the stage outgrows them (short list, wide screen); rebuilt by React. */
    const fit = () => {
      measure();
      const need = copiesNeeded(stage.clientWidth, geo[first]?.width ?? 0, period);
      if (need > sides) setSides(need);
    };
    const mark = () => {
      const mid = stage.clientWidth / 2;
      let best = cards[0];
      let bestDistance = Infinity;
      cards.forEach((card, i) => {
        const d = Math.abs(geo[i].left + x + geo[i].width / 2 - mid);
        if (d < bestDistance) {
          bestDistance = d;
          best = card;
        }
      });
      if (best !== current) {
        current?.removeAttribute("data-focus");
        best.setAttribute("data-focus", "");
        current = best;
        setFocused({ kicker: best.dataset.kicker ?? "", title: best.dataset.title ?? "" });
      }
    };
    const render = () => {
      wrap();
      track.style.transform = `translate3d(${x}px,0,0)`;
      mark();
    };
    let frames = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      // Geometry can change without a resize (fonts, the stylesheet or art arriving after the first
      // measure): stale offsets put the cards off screen while the caption still names one, so the
      // cards are measured again about once a second.
      if (++frames % 60 === 0) {
        measure();
        // Self-heal (what the arrow buttons did by hand): with no card on the stage, the strip goes
        // back to the first original under the lens.
        const box = stage.getBoundingClientRect();
        const onStage = cards.some((card) => {
          const r = card.getBoundingClientRect();
          return r.width > 0 && r.right > box.left && r.left < box.right;
        });
        if (!onStage && geo[first] && !drag && !glide) x = centred(first);
        // Keep the resting card exactly in the frame when the geometry moved under it.
        else if (current && !drag && !glide) {
          const to = centred(cards.indexOf(current));
          if (Math.abs(to - x) > 0.5) glide = { from: x, to, t0: t };
        }
      }
      if (glide) {
        const k = Math.min(1, (t - glide.t0) / GLIDE_MS);
        const e = 1 - Math.pow(1 - k, 3);
        x = glide.from + (glide.to - glide.from) * e;
        if (k >= 1) glide = null;
      } else if (!drag && !pausedRef.current && !hover && !focusInside && visible) {
        rest += dt * 1000;
        if (rest >= DWELL_MS) step(1);
      }
      render();
      frame = requestAnimationFrame(tick);
    };

    /** Glides the original of item `index` under the lens, along the shortest way round the loop. */
    const glideToItem = (index: number) => {
      rest = 0;
      const to = centred(first + index);
      if (readReduce()) {
        glide = null;
        x = to;
        render();
        return;
      }
      const near = to + Math.round((x - to) / period) * period;
      glide = { from: x, to: near, t0: performance.now() };
    };
    const itemOf = (card: HTMLElement | null) => {
      const i = card ? cards.indexOf(card) : -1;
      return i < 0 ? 0 : i % count;
    };
    const glideTo = (card: HTMLElement) => glideToItem(itemOf(card));
    const step = (dir: 1 | -1) => glideToItem((itemOf(current) + dir + count) % count);
    api.current = { step };
    // The server render leaves the strip at its start: settle the first card into the frame.
    if (phase.current === null) {
      mark();
      glideToItem(0);
    }

    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hover = true;
    };
    const onLeave = () => {
      hover = false;
    };
    const onFocusIn = (e: FocusEvent) => {
      focusInside = true;
      const card = (e.target as HTMLElement).closest<HTMLElement>(".tkw-card");
      if (card) glideTo(card);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!stage.contains(e.relatedTarget as Node | null)) focusInside = false;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { x0: e.clientX, start: x, moved: 0, id: e.pointerId };
      glide = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      // Capture only once it is a real drag, so plain clicks still reach the links.
      if (drag.moved > 6 && !stage.hasPointerCapture(e.pointerId)) {
        stage.setPointerCapture(e.pointerId);
        stage.setAttribute("data-dragging", "");
      }
      x = drag.start + dx;
    };
    let justDragged = false;
    const onUp = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      stage.removeAttribute("data-dragging");
      if (moved > 6) {
        justDragged = true;
        setTimeout(() => (justDragged = false), 0);
        if (current) glideTo(current);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (justDragged) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };

    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("focusin", onFocusIn);
    stage.addEventListener("focusout", onFocusOut);
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("click", onClick, true);
    stage.addEventListener("keydown", onKey);
    const io = new IntersectionObserver((entries) => entries.forEach((en) => (visible = en.isIntersecting)));
    io.observe(stage);
    // Also called once right away by the observer, with the real stage width.
    const ro = new ResizeObserver(fit);
    ro.observe(track);
    ro.observe(stage);
    frame = requestAnimationFrame(tick);
    // A reload (scroll restored, fonts and art arriving late) could leave stale offsets: measure again
    // once the page and its fonts are ready, and when it comes back from the back/forward cache.
    let disposed = false;
    const settle = () => {
      if (disposed) return;
      measure();
      if (geo[first]) wrap();
    };
    void document.fonts?.ready.then(settle);
    window.addEventListener("load", settle);
    window.addEventListener("pageshow", settle);

    return () => {
      disposed = true;
      window.removeEventListener("load", settle);
      window.removeEventListener("pageshow", settle);
      if (geo[first]) phase.current = x - centred(first);
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      api.current = null;
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("focusin", onFocusIn);
      stage.removeEventListener("focusout", onFocusOut);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("click", onClick, true);
      stage.removeEventListener("keydown", onKey);
    };
    // itemsKey / sides: rebuild when the cards or their copies change.
  }, [count, itemsKey, sides]);

  if (count === 0) return null;

  return (
    <section className={`tkw ${className}`} aria-labelledby={titleId}>
      <style href="tralked-news-wire" precedence="default">
        {CSS}
      </style>
      <div className="tkw-head">
        <h2 id={titleId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div
        ref={stageRef}
        className="tkw-stage"
        role="region"
        aria-roledescription="carrossel"
        aria-label={label}
      >
        <div ref={trackRef} className="tkw-track">
          {/* Copies before and after the originals for the endless loop: hidden from assistive tech and the tab order. */}
          {Array.from({ length: sides }, (_, c) =>
            items.map((item) => <WireCard key={`${item.id}<${c}`} item={item} hidden />),
          )}
          {items.map((item) => (
            <WireCard key={item.id} item={item} />
          ))}
          {Array.from({ length: sides }, (_, c) =>
            items.map((item) => <WireCard key={`${item.id}>${c}`} item={item} hidden />),
          )}
        </div>
        <div className="tkw-lens" aria-hidden="true" />
      </div>
      <div className="tkw-foot">
        <button
          type="button"
          className="tkw-pause"
          aria-pressed={paused}
          aria-label={paused ? "Retomar notícias" : "Pausar notícias"}
          onClick={() => setUserPaused(!paused)}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {paused ? (
              <path d="M7 4v16l13-8z" />
            ) : (
              <>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </>
            )}
          </svg>
        </button>
        <span className="tkw-focus" aria-live="off">
          {focused ? (
            <>
              {focused.kicker} · <b>{focused.title}</b>
            </>
          ) : null}
        </span>
        <div className="tkw-nav">
          <button type="button" className="tkw-btn" aria-label="Notícia anterior" onClick={() => api.current?.step(-1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10 3-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button type="button" className="tkw-btn" aria-label="Próxima notícia" onClick={() => api.current?.step(1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
