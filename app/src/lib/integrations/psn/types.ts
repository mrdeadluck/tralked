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
}
