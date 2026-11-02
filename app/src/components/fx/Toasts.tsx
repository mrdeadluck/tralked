"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SkillIcon } from "@/components/character/SkillIcon";
import type { LevelProgress } from "@/lib/progression/reward";
import { formatCompact, formatExact } from "@/lib/xp-format";
import { FxStyles } from "./FxStyles";

export type ToastData = {
  id: number;
  /** Headline, or the reason under "+N XP" when `xp` is set ("Curtida"). */
  title: string;
  /** Secondary line (plain toasts only). */
  text?: string;
  /** Any CSS color. Default: the accent. */
  color?: string;
  /** SkillId, "trophy" or a reward mark (SkillIcon). */
  icon?: string;
  /** XP toast: the headline becomes "+N XP" and ticks up when merged. */
  xp?: number;
  /** XP shown before the last merge (the figure counts from it). */
  prevXp?: number;
  /** Toasts with the same key merge while the first is on screen ("+10 XP · Curtida ×2"). */
  key?: string;
  /** How many events were merged into this toast. */
  count?: number;
  /** Bumped on every merge: restarts the fuse and the stamp. */
  generation?: number;
  leaving?: boolean;
  /** XP toast: the level bar it moved (fills from `before` to `after`). */
  progress?: LevelProgress;
  /** XP toast: the viewer's XP of the last 7 days after it (what Esta semana ranks). */
  weekXp?: number;
};

export type ToastInput = Omit<ToastData, "id" | "count" | "generation" | "leaving" | "prevXp">;

const MAX_TOASTS = 4;
export const TOAST_LIFETIME_MS = 4200;
const LEAVE_MS = 200;

/** Toast stack state: push (merging by key), dismiss, auto-expiry. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>[]>());

  const clearTimers = useCallback((id: number) => {
    timers.current.get(id)?.forEach(clearTimeout);
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number) => {
      clearTimers(id);
      const leave = setTimeout(() => {
        setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      }, TOAST_LIFETIME_MS - LEAVE_MS);
      const remove = setTimeout(() => {
        timers.current.delete(id);
        setToasts((current) => current.filter((t) => t.id !== id));
      }, TOAST_LIFETIME_MS);
      timers.current.set(id, [leave, remove]);
    },
    [clearTimers],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((list) => list.forEach(clearTimeout));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      let mergedId: number | null = null;
      setToasts((current) => {
        const live = toast.key ? current.find((t) => t.key === toast.key && !t.leaving) : undefined;
        if (live) {
          mergedId = live.id;
          return current.map((t) =>
            t.id === live.id
              ? {
                  ...t,
                  prevXp: t.xp,
                  xp: t.xp !== undefined || toast.xp !== undefined ? (t.xp ?? 0) + (toast.xp ?? 0) : undefined,
                  count: (t.count ?? 1) + 1,
                  generation: (t.generation ?? 0) + 1,
                  // The bar keeps filling from where this toast started (same level), to the newest point.
                  progress: toast.progress
                    ? {
                        ...toast.progress,
                        before:
                          t.progress && t.progress.level === toast.progress.level
                            ? t.progress.before
                            : toast.progress.before,
                      }
                    : t.progress,
                  weekXp: toast.weekXp ?? t.weekXp,
                }
              : t,
          );
        }
        const id = nextId.current++;
        mergedId = id;
        return [{ ...toast, id, count: 1, generation: 0 }, ...current].slice(0, MAX_TOASTS);
      });
      // setToasts runs its updater synchronously for the first update in an event handler, but
      // not always (concurrent rendering): defer the timer to the next tick, when it ran.
      setTimeout(() => {
        if (mergedId !== null) schedule(mergedId);
      }, 0);
    },
    [schedule],
  );

  const dismiss = useCallback(
    (id: number) => {
      clearTimers(id);
      setToasts((current) => current.filter((t) => t.id !== id));
    },
    [clearTimers],
  );

  return { toasts, push, dismiss };
}

/** The XP figure: counts from `from` to `value` when it mounts, compact pt-BR. */
function XpFigure({ from, value }: { from: number; value: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = formatCompact(value);
      return;
    }
    const start = performance.now();
    const duration = 520;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - 2 ** (-10 * t);
      el.textContent = formatCompact(Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = formatCompact(value);
    };
  }, [from, value]);

  return <span ref={ref}>{formatCompact(value)}</span>;
}

/**
 * "NV 12 ▬▬▬░░ 64%": the level bar the reward moved. It fills from where the XP found it to where it
 * left it (a level up starts it over), so even +5 XP is seen going somewhere.
 */
function LevelMeter({ progress }: { progress: LevelProgress }) {
  const pct = (n: number) => `${(Math.min(1, Math.max(0, n)) * 100).toFixed(1)}%`;
  return (
    <span aria-hidden="true" className="flex items-center gap-2 pt-0.5 font-mono text-xs text-text-3">
      <span className="whitespace-nowrap">
        NV <b className="font-bold text-text tabular-nums">{progress.level}</b>
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[1px] bg-track">
        <i
          className="block h-full bg-acc transition-[width] duration-700 ease-[cubic-bezier(.16,1,.3,1)] starting:w-(--from) motion-reduce:transition-none"
          style={{ "--from": pct(progress.before), width: pct(progress.after) } as CSSProperties}
        />
      </span>
      <span className="text-text-2 tabular-nums">{Math.floor(Math.min(1, progress.after) * 100)}%</span>
    </span>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * The toast stack (bottom right; full width on phones). Polite live region: screen readers hear
 * "+5 XP, Curtida" without losing focus; nothing here ever takes focus or blocks the page (the
 * container lets clicks through, only the toasts themselves catch them).
 */
export function Toasts({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss?: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[360px]"
    >
      <FxStyles />
      {toasts.map((toast) => {
        const isXp = toast.xp !== undefined;
        const merged = (toast.count ?? 1) > 1;
        const label = isXp
          ? `${toast.title}${merged ? ` ×${toast.count}` : ""}`
          : (toast.text ?? null);
        return (
          <div
            key={toast.id}
            data-leaving={toast.leaving ? "" : undefined}
            style={{ "--c": toast.color ?? "var(--acc)", "--life": `${TOAST_LIFETIME_MS}ms` } as CSSProperties}
            className="gl-toast pointer-events-auto relative grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-[4px] border border-line-2 bg-surface-2 py-2 pr-1 pl-2 shadow-[0_18px_36px_-14px_rgb(0_0_0/0.8)]"
          >
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-[2px] bg-[color-mix(in_srgb,var(--c)_14%,transparent)] text-(--c)"
            >
              <SkillIcon name={toast.icon ?? "trophy"} className="size-[22px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span aria-hidden="true" className="contents">
                {isXp ? (
                  <b
                    key={toast.generation}
                    title={`${formatExact(toast.xp ?? 0)} XP`}
                    className="gl-xp-stamp origin-left text-[22px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] text-acc tabular-nums"
                  >
                    +<XpFigure from={toast.prevXp ?? 0} value={toast.xp ?? 0} /> XP
                  </b>
                ) : (
                  <b className="truncate text-[15px] leading-tight font-extrabold">{toast.title}</b>
                )}
                {label ? (
                  <span className="truncate font-mono text-xs text-text-3">
                    {label}
                    {isXp && toast.weekXp !== undefined ? (
                      <span title={`${formatExact(toast.weekXp)} XP nos últimos 7 dias`}>
                        {" · "}
                        <b className="font-bold text-text-2">{formatCompact(toast.weekXp)} XP</b> na semana
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {isXp && toast.progress ? <LevelMeter progress={toast.progress} /> : null}
              </span>
              <span className="sr-only">
                {isXp ? `Mais ${formatExact(toast.xp ?? 0)} XP: ${label}.` : `${toast.title}. ${toast.text ?? ""}`}
                {isXp && toast.progress
                  ? ` Nível ${toast.progress.level}, ${Math.floor(toast.progress.after * 100)}% do caminho para o ${toast.progress.level + 1}.`
                  : null}
                {isXp && toast.weekXp !== undefined ? ` ${formatExact(toast.weekXp)} XP nesta semana.` : null}
              </span>
            </span>
            {onDismiss ? (
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Fechar aviso"
                className="grid size-11 cursor-pointer place-items-center rounded-[2px] text-dim transition-colors hover:bg-hover-2 hover:text-text"
              >
                <CloseIcon />
              </button>
            ) : (
              <span />
            )}
            <i key={`fuse-${toast.generation}`} aria-hidden="true" className="gl-fuse" />
          </div>
        );
      })}
    </div>
  );
}
