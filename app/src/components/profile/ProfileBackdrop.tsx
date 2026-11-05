"use client";

import { useEffect, useState } from "react";
import { RemoteImg } from "@/components/ui/RemoteImg";

/** Time each game's art stays behind the header. */
const TURN_MS = 9_000;
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
const ART_CLASS =
  "absolute inset-0 size-full scale-105 object-cover object-[center_30%] blur-[3px] saturate-[.45] transition-opacity duration-[1600ms] ease-in-out motion-reduce:transition-none";

/**
 * The art of the player's last games behind the profile header, taking turns with a slow
 * crossfade. Reduced motion (or a single image) keeps the first one still; a hidden tab does not
 * turn. Only the first image loads eagerly; the others load lazily before their turn.
 */
export function ProfileBackdrop({ urls }: { urls: string[] }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (urls.length < 2 || window.matchMedia(REDUCE_QUERY).matches) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setShown((i) => (i + 1) % urls.length);
    }, TURN_MS);
    return () => window.clearInterval(timer);
  }, [urls.length]);

  return urls.map((url, i) => (
    <RemoteImg
      key={url}
      url={url}
      alt=""
      width={1280}
      height={720}
      sizes="(max-width: 1280px) 100vw, 1280px"
      loading={i === 0 ? "eager" : "lazy"}
      className={`${ART_CLASS} ${i === shown ? "opacity-45" : "opacity-0"}`}
    />
  ));
}
