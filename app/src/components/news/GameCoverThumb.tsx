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
  /** chip: 27 px beside a name; card: 48 px; case: the 96 px game case of the article's game card. */
  variant: "chip" | "card" | "case";
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
  const width = variant === "chip" ? 27 : variant === "case" ? 96 : 48;
  return (
    <RemoteImg
      url={coverUrl}
      width={width}
      height={Math.round((width * 4) / 3)}
      sizes={`${width}px`}
      shape="fit"
      alt=""
      onFail={() => setFailed(true)}
      className={variant === "chip" ? "h-9 w-[27px] flex-none rounded-[2px] object-cover" : "block size-full object-cover"}
    />
  );
}
