"use client";

import { useState } from "react";
import { GameArt, type Hues } from "@/components/art/GameArt";
import { RemoteImg } from "@/components/ui/RemoteImg";

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
  // RemoteImg also reports an image that failed before hydration.
  const [failed, setFailed] = useState(false);

  if (!coverUrl || failed) {
    return variant === "chip" ? (
      <span className="w-1.5" aria-hidden="true" />
    ) : (
      <GameArt seed={seed} hues={hues} figure light width={120} height={160} />
    );
  }
  return (
    <RemoteImg
      url={coverUrl}
      width={variant === "chip" ? 27 : 48}
      height={variant === "chip" ? 36 : 64}
      sizes={variant === "chip" ? "27px" : "48px"}
      shape="fit"
      alt=""
      onFail={() => setFailed(true)}
      className={variant === "chip" ? "h-9 w-[27px] flex-none rounded-[2px] object-cover" : "block size-full object-cover"}
    />
  );
}
