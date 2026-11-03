"use client";

import { useSyncExternalStore } from "react";

/*
 * Link between the case intro and the "Ver a abertura de novo" button, which live in different
 * parts of the page. The intro registers its replay function once it is mounted (and only when
 * motion is allowed); the button renders only while one is registered, so it never appears
 * without JS or with reduced motion.
 */

let replay: (() => void) | null = null;
const listeners = new Set<() => void>();

export function registerCaseReplay(fn: () => void): () => void {
  replay = fn;
  listeners.forEach((l) => l());
  return () => {
    if (replay === fn) replay = null;
    listeners.forEach((l) => l());
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCaseReplay(): (() => void) | null {
  return useSyncExternalStore(subscribe, () => replay, () => null);
}

/** "Ver a abertura de novo": replays the intro. Absent without JS and with reduced motion. */
export function CaseReplayButton({ className = "" }: { className?: string }) {
  const play = useCaseReplay();
  if (!play) return null;
  return (
    <button type="button" className={className} onClick={play}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
      Ver a abertura de novo
    </button>
  );
}
