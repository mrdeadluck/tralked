import type { PlatformId } from "@/lib/engine/trophies";

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  steam: "Steam",
  psn: "PlayStation",
  xbox: "Xbox",
  retro: "RetroAchievements",
};

/** Platform color tokens (RetroAchievements has no console color: it takes the epic purple). */
export const PLATFORM_TOKEN: Record<PlatformId, string> = {
  steam: "var(--pc)",
  psn: "var(--ps)",
  xbox: "var(--xbox)",
  retro: "var(--r-epico)",
};
