export type XboxProfile = {
  xuid: string;
  gamertag: string;
  /** The profile bio (where the link verification code is pasted). */
  bio: string;
  avatarUrl: string | null;
};

export type XboxTitle = {
  titleId: string;
  name: string;
  currentAchievements: number;
  totalAchievements: number;
  currentGamerscore: number;
  totalGamerscore: number;
  /** Completion percentage 0-100. */
  progress: number;
  lastPlayed: Date | null;
  /** Devices of the title in the title history (`Xbox360`, `XboxOne`, `XboxSeries`, `PC`, `Win32`). */
  devices: string[];
};

export type XboxAchievement = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  hidden: boolean;
  gamerscore: number;
  unlocked: boolean;
  unlockedAt: Date | null;
  /** Share of players that unlocked it (0-100), null when Xbox does not say. */
  rarityPct: number | null;
};

export interface XboxApi {
  /** Null when no Xbox account has this gamertag. */
  findProfile(gamertag: string): Promise<XboxProfile | null>;
  /** The profile of a known XUID (no gamertag search); null when Xbox has no such account. */
  getProfile(xuid: string): Promise<XboxProfile | null>;
  /** `'private'` when the player's achievements are hidden from the service account. */
  getTitles(xuid: string): Promise<XboxTitle[] | "private">;
  /**
   * Every achievement of the title (unlocked or not) with the player's progress. `devices` (from the
   * title history) routes Xbox 360 titles to OpenXBL's 360 route.
   */
  getAchievements(xuid: string, titleId: string, devices?: string[]): Promise<XboxAchievement[] | "private">;
  /**
   * Minutes played per title (the titles' `MinutesPlayed` stat); titles Xbox has no number for
   * are left out. `'private'` when the player's stats are hidden.
   */
  getMinutesPlayed(xuid: string, titleIds: string[]): Promise<Map<string, number> | "private">;
}
