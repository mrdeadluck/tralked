"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const STORAGE_KEY = "tralked:sound-muted";

// Mute preference lives in localStorage; the module-level copy keeps the toggle working
// when storage is unavailable (private mode, blocked cookies).
let memoryMuted: boolean | null = null;
const listeners = new Set<() => void>();

function readMuted(): boolean {
  if (memoryMuted !== null) return memoryMuted;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean) {
  memoryMuted = muted;
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // sem persistência: vale só nesta sessão
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      memoryMuted = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

type OscillatorKind = "triangle" | "square" | "sine" | "sawtooth";

export type Sound = {
  muted: boolean;
  toggleMuted: () => void;
  /**
   * Cria/retoma o AudioContext. Chame dentro de um handler de clique: navegadores só
   * liberam áudio depois de uma interação do usuário, e `play` não faz nada antes disso.
   */
  unlock: () => void;
  /** Arpejo de `notes` (Hz), uma nota a cada `step` segundos, a partir de `delay` segundos. */
  play: (notes: number[], step?: number, type?: OscillatorKind, delay?: number) => void;
};

export function useSound(): Sound {
  const muted = useSyncExternalStore(subscribe, readMuted, () => false);
  const contextRef = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    try {
      if (!contextRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        contextRef.current = new Ctor();
      }
      if (contextRef.current.state === "suspended") void contextRef.current.resume();
    } catch {
      // sem áudio disponível
    }
  }, []);

  const play = useCallback<Sound["play"]>((notes, step = 0.12, type = "triangle", delay = 0) => {
    const context = contextRef.current;
    if (!context || readMuted()) return;
    try {
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + delay + index * step;
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + step * 1.8);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + step * 2);
      });
    } catch {
      // sem áudio disponível
    }
  }, []);

  const toggleMuted = useCallback(() => writeMuted(!readMuted()), []);

  return { muted, toggleMuted, unlock, play };
}
