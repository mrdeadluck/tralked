"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SkillIcon } from "@/components/character/SkillIcon";
import { FxStyles } from "./FxStyles";

export type ToastData = {
  id: number;
  title: string;
  text: string;
  /** Qualquer cor CSS. Padrão: acento. */
  color?: string;
  /** SkillId ou "trophy". */
  icon?: string;
};

const MAX_TOASTS = 4;
const LIFETIME_MS = 4200;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const push = useCallback((toast: Omit<ToastData, "id">) => {
    const id = nextId.current++;
    setToasts((current) => [{ ...toast, id }, ...current].slice(0, MAX_TOASTS));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((current) => current.filter((t) => t.id !== id));
    }, LIFETIME_MS);
    timers.current.add(timer);
  }, []);

  return { toasts, push };
}

export function Toasts({ toasts }: { toasts: ToastData[] }) {
  return (
    <div
      aria-live="polite"
      className="fixed right-5 bottom-5 z-40 flex w-[min(360px,calc(100vw-40px))] flex-col gap-2"
    >
      <FxStyles />
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{ "--c": toast.color ?? "var(--acc)" } as CSSProperties}
          className={`gl-toast grid grid-cols-[40px_1fr] items-center gap-3 rounded-[2px] border border-l-[3px] border-[#2a2c33] border-l-(--c) bg-surface-2 px-3.5 py-3 shadow-[0_20px_40px_rgba(0,0,0,0.5)]`}
        >
          <div className="grid size-10 place-items-center bg-[color-mix(in_srgb,var(--c)_12%,transparent)] text-(--c)">
            <SkillIcon name={toast.icon ?? "trophy"} className="size-[22px]" />
          </div>
          <div>
            <b className="block text-[15px] font-extrabold">{toast.title}</b>
            <span className="font-mono text-xs text-dim uppercase">{toast.text}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
