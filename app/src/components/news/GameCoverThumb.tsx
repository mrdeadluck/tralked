"use client";

import { useEffect, useRef, useState } from "react";
import { GameArt, type Hues } from "@/components/art/GameArt";

/**
 * Catalog cover of a game related to an article (Plan 4 F12). Decorative: the game's name is
 * always next to it. When there is no cover (stubs) or it fails to load, the chip shows the name
 * only and the card falls back to the generated art: never a broken image.
 */
export function GameCoverThumb({
  coverUrl,
  variant,
  seed,
  hues,
}: {
  coverUrl: string | null;
  variant: "chip" | "card";
  seed: number;
  hues: Hues;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  // An image that failed before hydration fired its error event before React listened.
  useEffect(() => {
    const img = ref.current;
    // currentSrc: the browser did try this URL (a lazy image not yet requested is not "complete").
    if (img?.complete && img.currentSrc && img.naturalWidth === 0) setFailed(true);
  }, [coverUrl]);

  if (!coverUrl || failed) {
    return variant === "chip" ? (
      <span className="w-1.5" aria-hidden="true" />
    ) : (
      <GameArt seed={seed} hues={hues} figure light width={120} height={160} />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote catalog hosts are not configured for next/image
    <img
      ref={ref}
      src={coverUrl}
      alt=""
      width={variant === "chip" ? 27 : 48}
      height={variant === "chip" ? 36 : 64}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={variant === "chip" ? "h-9 w-[27px] flex-none rounded-[2px] object-cover" : "block size-full object-cover"}
    />
  );
}
