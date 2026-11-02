"use client";

import { useEffect } from "react";
import { loadRetroAchievements } from "@/app/jogos/[slug]/retro-actions";

/**
 * Rendered only while the game has a RetroAchievements set never read: asks the server once, in
 * the background, to read it (the action refreshes the page when new achievements arrive).
 * Renders nothing.
 */
export function RetroAchievementsLoader({ gameId }: { gameId: string }) {
  useEffect(() => {
    void loadRetroAchievements(gameId).catch(() => undefined);
  }, [gameId]);
  return null;
}
