"use client";

import { useEffect } from "react";
import { loadPsnTrophies } from "@/app/jogos/[slug]/psn-actions";

/**
 * Rendered only while the game has a PSN trophy list never read: asks the server once, in the
 * background, to read one (the action refreshes the page when trophies arrive). Renders nothing.
 */
export function PsnTrophiesLoader({ gameId }: { gameId: string }) {
  useEffect(() => {
    void loadPsnTrophies(gameId).catch(() => undefined);
  }, [gameId]);
  return null;
}
