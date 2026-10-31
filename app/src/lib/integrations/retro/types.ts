export type RetroProfile = {
  /** Current username (can change). */
  user: string;
  /** Stable id of the account (used as LinkedAccount.externalId). */
  ulid: string;
  /** The profile motto (where the link verification code is pasted). */
  motto: string;
  avatarUrl: string | null;
};

export type RetroGame = {
  gameId: string;
  title: string;
  consoleName: string;
  /** Achievements in the game's set. */
  maxPossible: number;
  numAwarded: number;
  numAwardedHardcore: number;
  lastPlayed: Date | null;
};

export type RetroAchievement = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  points: number;
  /** Share of the game's players that unlocked it (0-100), null when unknown. */
  rarityPct: number | null;
  earned: boolean;
  earnedAt: Date | null;
  /** Earned in hardcore mode (no save states, rewind or cheats). */
  hardcore: boolean;
};

export type RetroGameProgress = {
  playtimeMin: number | null;
  achievements: RetroAchievement[];
};

export interface RetroApi {
  /** `user` is a username or ULID. Null when no such account exists. */
  findProfile(user: string): Promise<RetroProfile | null>;
  /** Games the user has progress in. */
  getGames(user: string): Promise<RetroGame[]>;
  /** The game's achievement set with the user's unlocks (hardcore flagged per unlock). */
  getGameProgress(user: string, gameId: string): Promise<RetroGameProgress>;
}
