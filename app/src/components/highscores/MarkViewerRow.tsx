"use client";

import { useEffect } from "react";

/**
 * The board markup is static (cached for everyone), so the viewer's own podium slot and list row
 * are marked here, after hydration: `data-me` (highlight and "você"), `aria-current`, and the
 * `#minha-posicao` anchor of the "Ver na lista" shortcut.
 */
export function MarkViewerRow({ userId, boardKey }: { userId: string; boardKey: string }) {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(`[data-player-id="${CSS.escape(userId)}"]`)];
    for (const el of els) {
      el.setAttribute("data-me", "");
      el.setAttribute("aria-current", "true");
    }
    const anchor = els[0] && !document.getElementById("minha-posicao") ? els[0] : null;
    if (anchor) anchor.id = "minha-posicao";
    return () => {
      for (const el of els) {
        el.removeAttribute("data-me");
        el.removeAttribute("aria-current");
      }
      if (anchor) anchor.removeAttribute("id");
    };
  }, [userId, boardKey]);
  return null;
}
