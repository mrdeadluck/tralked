"use client";

import { useState } from "react";
import { Placeholder } from "@/components/ui/Placeholder";

type GameCoverProps = {
  name: string;
  coverUrl: string | null;
  /** CSS aspect-ratio. Defaults to the preview's 16 / 10. */
  ratio?: string;
  /** Lists and grids: load the image only near the viewport. */
  lazy?: boolean;
};

/**
 * Cover art when we have it (catalog art, or the Steam store header for games still without
 * details), otherwise — or when the image fails to load — the striped placeholder.
 */
export function GameCover({ name, coverUrl, ratio = "16 / 10", lazy = false }: GameCoverProps) {
  const [failed, setFailed] = useState(false);
  if (!coverUrl || failed) return <Placeholder label={`capa: ${name.toLowerCase()}`} ratio={ratio} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote hosts are not configured for next/image
    <img
      src={coverUrl}
      alt={`Capa de ${name}`}
      loading={lazy ? "lazy" : undefined}
      onError={() => setFailed(true)}
      style={{ aspectRatio: ratio }}
      className="block w-full rounded-[3px] object-cover"
    />
  );
}
