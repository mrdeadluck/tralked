"use client";

import { useEffect } from "react";

/** Same window as the server's VIEW_DEDUPE_MS (lib/news/views.ts, not imported: it is server code). */
const REPEAT_MS = 30 * 60_000;
const STORAGE_KEY = "tlk:views";

/** Recent views remembered by this browser: article id -> time. Tolerates blocked storage. */
function seenRecently(articleId: string, now: number): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>;
    const recent = Object.fromEntries(Object.entries(raw).filter(([, at]) => now - at < REPEAT_MS));
    const seen = recent[articleId] !== undefined;
    if (!seen) recent[articleId] = now;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    return seen;
  } catch {
    return false;
  }
}

function send(articleId: string) {
  const body = JSON.stringify({ articleId });
  if (navigator.sendBeacon?.("/api/views", body)) return;
  void fetch("/api/views", { method: "POST", body, keepalive: true, credentials: "same-origin" }).catch(() => {});
}

/**
 * Counts one view of the article (item 11) once it is really seen: after hydration, in a visible
 * tab, never during a prerender, never for automated browsers. Renders nothing.
 */
export function ArticleViewBeacon({ articleId }: { articleId: string }) {
  useEffect(() => {
    if (navigator.webdriver) return;
    let done = false;
    const fire = () => {
      const doc = document as Document & { prerendering?: boolean };
      if (done || doc.prerendering || document.visibilityState !== "visible") return;
      done = true;
      cleanup();
      if (!seenRecently(articleId, Date.now())) send(articleId);
    };
    const cleanup = () => {
      document.removeEventListener("visibilitychange", fire);
      document.removeEventListener("prerenderingchange", fire);
    };
    document.addEventListener("visibilitychange", fire);
    document.addEventListener("prerenderingchange", fire);
    fire();
    return cleanup;
  }, [articleId]);
  return null;
}
