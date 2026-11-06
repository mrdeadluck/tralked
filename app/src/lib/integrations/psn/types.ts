import type { TrophyTier } from "@/lib/engine/trophies";

export type PsnProfile = {
  accountId: string;
  onlineId: string;
  /** The profile's "Sobre mim" text (where the link verification code is pasted). */
  aboutMe: string;
  avatarUrl: string | null;
  /** True when the trophy list is not visible to the service account. */
  isPrivate: boolean;
};

/** PS3/PS4/Vita trophy sets use `trophy`; PS5 sets use `trophy2`. */
export type PsnServiceName = "trophy" | "trophy2";

export type PsnTitle = {
  /** npCommunicationId, e.g. `NPWR20188_00`. */
  npTitleId: string;
  serviceName: PsnServiceName;
  name: string;
  /** e.g. `PS4`, `PS5`, `PS4,PS5`. */
  platform: string;
  /** Completion percentage 0-100. */
  progress: number;
  trophyCounts: Record<TrophyTier, number>;
  earnedCounts: Record<TrophyTier, number>;
  lastPlayed: Date | null;
};

export type PsnTrophy = {
  trophyId: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  hidden: boolean;
  tier: TrophyTier;
  earned: boolean;
  earnedAt: Date | null;
  /** Share of players that earned it (0-100), null when PSN does not say. */
  rarityPct: number | null;
};

/** A PS4/PS5 game the player has played, with PSN's own play time (gamelist v2). */
export type PsnPlayedGame = {
  /** Store title id of the version played, e.g. `CUSA01433_00` or `PPSA01325_00`. */
  titleId: string;
  name: string;
  /** `ps4_game` | `ps5_native_game` | `pspc_game` | `unknown`. */
  category: string;
  /** `playDuration` in whole minutes (PSN counts it to the second). */
  playtimeMin: number;
  firstPlayedAt: Date | null;
  lastPlayedAt: Date | null;
  /**
   * PSN concept of the game (`concept.id`): one per game across regions and consoles (GTA V's
   * PS4 and PS5 versions of every region share one). Null when PSN gives none.
   */
  conceptId: number | null;
  /** Store title ids of every version of the concept (`concept.titleIds`), e.g. CUSA… and PPSA…. */
  conceptTitleIds: string[];
  /** The concept's own name (`concept.name`): often the English one when the version's is Japanese. */
  conceptName: string | null;
};

/** What one trophyGroups call says about a list, with no player involved. */
export type PsnListInfo = {
  /** npCommunicationId asked. */
  npTitleId: string;
  serviceName: PsnServiceName;
  name: string;
  /** e.g. `PS4`, `PS5`, `PSVITA,PS4`. */
  platform: string;
  trophyCounts: Record<TrophyTier, number>;
};

export type TrophyListsOptions = {
  /**
   * Epoch ms after which no further request is started: the ids not asked are left out of the
   * answer (the caller asks them another time).
   */
  deadline?: number;
};

export interface PsnApi {
  /** Null when no PSN account has this online id. */
  findProfile(onlineId: string): Promise<PsnProfile | null>;
  /** `'private'` when the trophy list is hidden from the service account. */
  getTitles(accountId: string): Promise<PsnTitle[] | "private">;
  /** Every trophy of the title (earned or not) with the user's progress. */
  getTrophies(
    accountId: string,
    npTitleId: string,
    serviceName: PsnServiceName,
  ): Promise<PsnTrophy[] | "private">;
  /** PS4/PS5 games played, with play time; `'private'` when the gaming history is hidden. */
  getPlayedGames(accountId: string): Promise<PsnPlayedGame[] | "private">;
  /**
   * Trophy lists (npCommunicationIds) of store title ids, as seen through the account of a player
   * who played them: title id → its lists (`[]` when PSN does not know the id for that player).
   * `'private'` when the trophies are hidden from the service account.
   */
  getTrophyListsOfTitles(
    accountId: string,
    titleIds: string[],
    options?: TrophyListsOptions,
  ): Promise<Map<string, string[]> | "private">;
  /**
   * The name, platform and trophy counts of a list (`trophyGroups`), for any list, without a
   * player. Null when Sony has no such list on that service (404). Throws PsnHttpError on 403,
   * 429 and 5xx, so a scan can back off.
   */
  getListInfo(npTitleId: string, serviceName: PsnServiceName): Promise<PsnListInfo | null>;
  /**
   * The trophy definitions of a list (`trophyGroups/all/trophies`), for any list, without a
   * player: nobody has earned anything (`earned` false, no rarity). Null when Sony has no such
   * list or no trophies in it. Throws on 403, 429 and 5xx: a caller reading on demand tries later.
   */
  getListTrophies(npTitleId: string, serviceName: PsnServiceName): Promise<PsnTrophy[] | null>;
}
