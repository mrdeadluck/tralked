"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { openedKey } from "./opened-key";

/*
 * Veils the game page before its first paint when this is likely the visitor's first time with
 * the game (no "opened" flag in this browser, motion allowed), so the case intro drops onto a
 * clean stage instead of after a flash of the page. The account check comes later, in the intro
 * island; if the intro never takes over, page CSS unveils after a few seconds.
 *
 * - Full page load: an inline script, part of the server HTML, decides before the first paint.
 *   It is only rendered for the server/hydration pass.
 * - Client-side navigation (a <Link> from the catalog, gallery, forum...): React never runs
 *   scripts it renders, so a layout effect decides instead; it runs after the new page is in the
 *   DOM and before the browser paints it.
 */

const ROOT_ID = "gp-root";
const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeNothing = () => () => undefined;

function inlineScript(slug: string) {
  const key = JSON.stringify(openedKey(slug)).replace(/</g, "\\u003c");
  return `(function(){try{var r=document.getElementById(${JSON.stringify(ROOT_ID)});if(!r||matchMedia(${JSON.stringify(REDUCE)}).matches||localStorage.getItem(${key})==="1")return;r.setAttribute("data-intro","pending")}catch(e){}})();`;
}

function veilIfFirstVisit(slug: string) {
  try {
    if (window.matchMedia(REDUCE).matches || localStorage.getItem(openedKey(slug)) === "1") return;
    document.getElementById(ROOT_ID)?.setAttribute("data-intro", "pending");
  } catch {
    // sem armazenamento local: a página aparece sem véu
  }
}

export function IntroVeil({ slug }: { slug: string }) {
  // false on the server and while hydrating a full page load; true when mounted by a client render.
  const clientRender = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const fromServerHtml = useRef(!clientRender);

  useLayoutEffect(() => {
    if (fromServerHtml.current) {
      // The inline script already decided before the first paint.
      fromServerHtml.current = false;
      return;
    }
    veilIfFirstVisit(slug);
  }, [slug]);

  return clientRender ? null : <script dangerouslySetInnerHTML={{ __html: inlineScript(slug) }} />;
}
