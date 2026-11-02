"use client";

import { useState } from "react";
import { Placeholder } from "@/components/ui/Placeholder";
import { RemoteImg } from "@/components/ui/RemoteImg";

type GameCoverProps = {
  name: string;
  coverUrl: string | null;
  /** CSS aspect-ratio. Defaults to the preview's 16 / 10. */
  ratio?: string;
  /** Lists and grids: load the image only near the viewport. */
  lazy?: boolean;
  /** Widest the cover renders (CSS px) and its `sizes`, for the CDN copy to request. */
  width?: number;
  sizes?: string;
};

/** "3 / 4" → 0.75; anything unreadable counts as wide. */
function ratioOf(ratio: string): number {
  const [w, h] = ratio.split("/").map((part) => Number(part.trim()));
  return w > 0 && h > 0 ? w / h : 16 / 10;
}

/**
 * Cover art when we have it (catalog art, or the Steam store header for games still without
 * details), otherwise — or when the image fails to load — the striped placeholder.
 */
export function GameCover({
  name,
  coverUrl,
  ratio = "16 / 10",
  lazy = false,
  width = 320,
  sizes = "(max-width: 640px) 50vw, 320px",
}: GameCoverProps) {
  const [failed, setFailed] = useState(false);
  if (!coverUrl || failed) return <Placeholder label={`capa: ${name.toLowerCase()}`} ratio={ratio} />;
  const aspect = ratioOf(ratio);
  return (
    <RemoteImg
      url={coverUrl}
      width={width}
      height={Math.round(width / aspect)}
      sizes={sizes}
      shape={aspect < 1 ? "fit" : "wide"}
      alt={`Capa de ${name}`}
      loading={lazy ? "lazy" : "eager"}
      onFail={() => setFailed(true)}
      style={{ aspectRatio: ratio }}
      className="block h-auto w-full rounded-[3px] object-cover"
    />
  );
}
