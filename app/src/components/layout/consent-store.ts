"use client";

import { useSyncExternalStore } from "react";
import { consentCookie, readConsent, type ConsentChoice } from "@/lib/consent";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** "unknown" on the server and during hydration: nothing consent-related renders before the browser reads the cookie. */
export type ConsentState = ConsentChoice | null | "unknown";

const getSnapshot = (): ConsentState => readConsent(document.cookie);
const getServerSnapshot = (): ConsentState => "unknown";

/** The visitor's cookie choice, shared by the banner and the preferences on /privacidade. */
export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function saveConsent(choice: ConsentChoice) {
  document.cookie = consentCookie(choice, window.location.protocol === "https:");
  for (const listener of listeners) listener();
}
